const DEFAULT_ALLOWED_EMAILS = ['lucianoazzigotti@gmail.com', 'admin@musiki.org.ar'];

export const chirpAllowedEmails = ():string[] => {
  const configured = String(process.env.GOOGLE_TTS_ALLOWED_EMAILS || '').split(',').map((email) => email.trim().toLowerCase()).filter(Boolean);
  return configured.length ? [...new Set(configured)] : DEFAULT_ALLOWED_EMAILS;
};

export const chirpAccessAllowed = (email:string):boolean => chirpAllowedEmails().includes(String(email || '').trim().toLowerCase());
