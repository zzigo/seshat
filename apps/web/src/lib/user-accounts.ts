import { getCatalog, isSessionAccountAdmin, sessionIdentity } from './catalog';

export type AccountStatus = 'pending' | 'approved' | 'suspended';
export type Institution = 'none' | 'untref' | 'nmh';
export type StorageProvider = 'undecided' | 'google-drive' | 'managed-wasabi';

export interface UserAccount {
  ownerKey: string;
  email: string;
  name: string;
  status: AccountStatus;
  institution: Institution;
  institutionEmail?: string;
  quotaRequested: boolean;
  quotaBytes: number;
  storageProvider: StorageProvider;
  storageRootName: string;
  locale: 'en' | 'es';
  onboardingStep: number;
  onboardingCompleted: boolean;
  firstSeenAt: string;
  lastSeenAt: string;
  lastLoginAt?: string;
  approvedAt?: string;
}

const fromRow = (row: any): UserAccount => ({
  ownerKey: String(row.owner_key), email: String(row.primary_email), name: String(row.display_name || ''),
  status: row.status, institution: row.institution, institutionEmail: row.institution_email || undefined,
  quotaRequested: row.quota_requested === true, quotaBytes: Number(row.quota_bytes || 0),
  storageProvider: row.storage_provider, storageRootName: String(row.storage_root_name || 'Seshat'),
  locale: row.onboarding_locale === 'es' ? 'es' : 'en', onboardingStep: Number(row.onboarding_step || 0),
  onboardingCompleted: Boolean(row.onboarding_completed_at), firstSeenAt: new Date(row.first_seen_at).toISOString(),
  lastSeenAt: new Date(row.last_seen_at).toISOString(),
  lastLoginAt: row.last_login_at ? new Date(row.last_login_at).toISOString() : undefined,
  approvedAt: row.approved_at ? new Date(row.approved_at).toISOString() : undefined,
});

const activityHeartbeat = new Map<string, number>();

export const registerSessionAccount = async (session: any, ownerKey: string): Promise<UserAccount> => {
  const catalog = getCatalog(); await catalog.ensureSchema();
  const identity = sessionIdentity(session);
  const admin = isSessionAccountAdmin(session);
  const established = await catalog.pool.query(
    `SELECT EXISTS(SELECT 1 FROM catalog_references WHERE owner_key=$1) OR
            EXISTS(SELECT 1 FROM catalog_zotero_connections WHERE owner_key=$1) AS value`, [ownerKey],
  );
  const initialApproved = admin || established.rows[0]?.value === true;
  const loginAt = String(session?.user?.signedInAt || '').trim();
  const validLoginAt = Number.isFinite(Date.parse(loginAt)) ? loginAt : null;
  const result = await catalog.pool.query(
    `INSERT INTO catalog_user_accounts
      (owner_key,primary_email,display_name,status,onboarding_step,onboarding_completed_at,last_login_at,approved_at,approved_by)
     VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9)
     ON CONFLICT(owner_key) DO UPDATE SET
       primary_email=excluded.primary_email,display_name=excluded.display_name,last_seen_at=now(),
       last_login_at=CASE WHEN excluded.last_login_at IS NOT NULL AND
         (catalog_user_accounts.last_login_at IS NULL OR excluded.last_login_at>catalog_user_accounts.last_login_at)
         THEN excluded.last_login_at ELSE catalog_user_accounts.last_login_at END,
       status=CASE WHEN $10::boolean THEN 'approved' ELSE catalog_user_accounts.status END,
       approved_at=CASE WHEN $10::boolean THEN COALESCE(catalog_user_accounts.approved_at,now()) ELSE catalog_user_accounts.approved_at END,
       approved_by=CASE WHEN $10::boolean THEN COALESCE(catalog_user_accounts.approved_by,$2) ELSE catalog_user_accounts.approved_by END,
       updated_at=now()
     RETURNING *`,
    [ownerKey, identity.email, String(session?.user?.name || ''), initialApproved ? 'approved' : 'pending',
      initialApproved ? 5 : 0, initialApproved ? new Date().toISOString() : null, validLoginAt,
      initialApproved ? new Date().toISOString() : null, initialApproved ? identity.email : null, admin],
  );
  const now = Date.now(); const previous = activityHeartbeat.get(ownerKey) || 0;
  if (now - previous > 5 * 60_000) {
    activityHeartbeat.set(ownerKey, now);
    await catalog.pool.query(
      `INSERT INTO catalog_user_activity(owner_key,activity_day,activity_hour,request_count)
       VALUES($1,(now() AT TIME ZONE 'UTC')::date,extract(hour FROM now() AT TIME ZONE 'UTC')::int,1)
       ON CONFLICT(owner_key,activity_day,activity_hour) DO UPDATE SET
         request_count=catalog_user_activity.request_count+1,last_seen_at=now()`, [ownerKey],
    ).catch(() => undefined);
  }
  return fromRow(result.rows[0]);
};

export const getUserAccount = async (ownerKey: string): Promise<UserAccount | null> => {
  const catalog = getCatalog(); await catalog.ensureSchema();
  const result = await catalog.pool.query('SELECT * FROM catalog_user_accounts WHERE owner_key=$1', [ownerKey]);
  return result.rows[0] ? fromRow(result.rows[0]) : null;
};

export const updateOnboarding = async (ownerKey: string, input: {
  locale?: unknown; institution?: unknown; institutionEmail?: unknown; quotaRequested?: unknown;
  storageProvider?: unknown; storageRootName?: unknown; step?: unknown; completed?: unknown;
}): Promise<UserAccount> => {
  const locale = input.locale === 'es' ? 'es' : 'en';
  const institution: Institution = ['untref','nmh'].includes(String(input.institution)) ? input.institution as Institution : 'none';
  let storageProvider: StorageProvider = ['google-drive','managed-wasabi'].includes(String(input.storageProvider)) ? input.storageProvider as StorageProvider : 'undecided';
  if (storageProvider === 'managed-wasabi' && institution === 'none') storageProvider = 'undecided';
  const institutionEmail = String(input.institutionEmail || '').trim().toLowerCase().slice(0, 254) || null;
  const root = String(input.storageRootName || 'Seshat').trim().replace(/[\\/\u0000-\u001f]/g, ' ').replace(/\s+/g, ' ').slice(0, 100) || 'Seshat';
  const step = Math.max(0, Math.min(5, Math.floor(Number(input.step || 0))));
  const completed = input.completed === true;
  const catalog = getCatalog(); await catalog.ensureSchema();
  const result = await catalog.pool.query(
    `UPDATE catalog_user_accounts SET onboarding_locale=$2,institution=$3,institution_email=$4,
       quota_requested=$5,storage_provider=$6,storage_root_name=$7,onboarding_step=$8,
       onboarding_completed_at=CASE WHEN $9 THEN COALESCE(onboarding_completed_at,now()) ELSE onboarding_completed_at END,
       updated_at=now() WHERE owner_key=$1 RETURNING *`,
    [ownerKey, locale, institution, institutionEmail, input.quotaRequested === true && institution !== 'none',
      storageProvider, root, step, completed],
  );
  if (!result.rows[0]) throw new Error('ACCOUNT_NOT_FOUND');
  return fromRow(result.rows[0]);
};

export const listAdminUsers = async () => {
  const catalog = getCatalog(); await catalog.ensureSchema();
  const [users, activity] = await Promise.all([
    catalog.pool.query(`SELECT a.*,
      (SELECT count(*) FROM catalog_references r WHERE r.owner_key=a.owner_key)::int AS item_count,
      (SELECT COALESCE(sum(ar.size_bytes),0) FROM catalog_artifacts ar JOIN catalog_references r ON r.id=ar.reference_id WHERE r.owner_key=a.owner_key)::bigint AS storage_bytes,
      (SELECT count(*) FROM catalog_libraries l WHERE l.owner_key=a.owner_key)::int AS library_count
      FROM catalog_user_accounts a ORDER BY CASE a.status WHEN 'pending' THEN 0 WHEN 'approved' THEN 1 ELSE 2 END,a.created_at DESC`),
    catalog.pool.query(`SELECT owner_key,activity_day::text AS day,sum(request_count)::bigint AS requests
      FROM catalog_user_activity WHERE activity_day>=current_date-83 GROUP BY owner_key,activity_day ORDER BY activity_day`),
  ]);
  const heat = new Map<string, Array<{ day:string; requests:number }>>();
  for (const row of activity.rows) heat.set(row.owner_key, [...(heat.get(row.owner_key) || []), { day:row.day, requests:Number(row.requests) }]);
  return users.rows.map((row:any) => ({ ...fromRow(row), itemCount:Number(row.item_count), libraryCount:Number(row.library_count),
    storageBytes:Number(row.storage_bytes), activity:heat.get(row.owner_key) || [] }));
};

export const setAccountApproval = async (ownerKey: string, action: 'approve'|'suspend'|'restore', adminEmail: string, quotaBytes?: number) => {
  const status: AccountStatus = action === 'suspend' ? 'suspended' : 'approved';
  const catalog = getCatalog(); await catalog.ensureSchema();
  const result = await catalog.pool.query(
    `UPDATE catalog_user_accounts SET status=$2,quota_bytes=CASE WHEN $2='approved' THEN $3 ELSE quota_bytes END,
      approved_at=CASE WHEN $2='approved' THEN COALESCE(approved_at,now()) ELSE approved_at END,
      approved_by=CASE WHEN $2='approved' THEN $4 ELSE approved_by END,updated_at=now()
     WHERE owner_key=$1 RETURNING *`, [ownerKey, status, Math.max(0, Math.floor(quotaBytes || 0)), adminEmail],
  );
  if (!result.rows[0]) throw new Error('ACCOUNT_NOT_FOUND');
  return fromRow(result.rows[0]);
};

export const assertManagedStorageQuota = async (ownerKey:string, additionalBytes:number, replacedBytes=0):Promise<void> => {
  const catalog=getCatalog();await catalog.ensureSchema();
  const result=await catalog.pool.query(`SELECT a.storage_provider,a.quota_bytes,
    (SELECT COALESCE(sum(ar.size_bytes),0) FROM catalog_artifacts ar JOIN catalog_references r ON r.id=ar.reference_id WHERE r.owner_key=a.owner_key)::bigint AS used_bytes
    FROM catalog_user_accounts a WHERE a.owner_key=$1`,[ownerKey]);
  const row=result.rows[0];if(!row||row.storage_provider!=='managed-wasabi')return;
  const quota=Number(row.quota_bytes||0);const projected=Math.max(0,Number(row.used_bytes||0)-Math.max(0,replacedBytes))+Math.max(0,additionalBytes);
  if(quota<=0||projected>quota)throw new Error('MANAGED_STORAGE_QUOTA_EXCEEDED');
};
