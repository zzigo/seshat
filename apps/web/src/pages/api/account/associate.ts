import type { APIRoute } from 'astro';
import { getCatalog, ownerKeyFor, sessionIdentity } from '../../../lib/catalog';

export const POST: APIRoute = async ({ request, locals }) => {
  const session = (locals as any).session;
  const identity = sessionIdentity(session);
  if (!identity.email || !identity.subject) {
    return Response.json({ error: 'stable_identity_required' }, { status: 401 });
  }

  const body = await request.json().catch(() => null);
  const secondaryEmail = String(body?.secondaryEmail || '').trim().toLowerCase();
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(secondaryEmail)) {
    return Response.json({ error: 'valid_secondary_email_required' }, { status: 400 });
  }

  const currentOwnerKey = ownerKeyFor(identity.email);

  try {
    const catalog = getCatalog();

    // Check if there is already an identity mapping for the secondary email
    const existing = await catalog.pool.query(
      'SELECT identity_key, owner_key FROM catalog_identities WHERE lower(current_email) = lower($1)',
      [secondaryEmail]
    );

    if (existing.rows.length > 0) {
      // It exists! Let's merge its catalog contents and map its identities to our currentOwnerKey
      for (const row of existing.rows) {
        if (row.owner_key !== currentOwnerKey) {
          const result = await catalog.recoverIdentity(row.identity_key, row.owner_key, currentOwnerKey, secondaryEmail);
          if (!result.ok) {
            return Response.json({ error: result.reason }, { status: 409 });
          }
        }
      }
    } else {
      // Create a placeholder identity mapping so when they log in it associates with the currentOwnerKey
      const targetIdentityKey = `associated:${secondaryEmail}`;
      await catalog.pool.query(
        `INSERT INTO catalog_identities(identity_key, owner_key, provider, subject, current_email)
         VALUES($1, $2, 'associated', 'placeholder', $3)
         ON CONFLICT (identity_key) DO UPDATE SET owner_key = excluded.owner_key, updated_at = now()`,
        [targetIdentityKey, currentOwnerKey, secondaryEmail]
      );
    }

    console.info('[seshat:identity-association]', {
      currentOwner: currentOwnerKey.slice(0, 8),
      associatedEmail: secondaryEmail
    });

    return Response.json({ ok: true });
  } catch (error) {
    console.error('[seshat:identity-association-error]', error);
    return Response.json({ error: 'internal_error' }, { status: 500 });
  }
};
