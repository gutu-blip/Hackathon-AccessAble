import { get, ref as dbRef, serverTimestamp, set } from 'firebase/database';
import { getDownloadURL, ref as storageRef, uploadBytes } from 'firebase/storage';
import { db, storage } from '../firebase';

/**
 * User profile schema for persons with disabilities and/or caregivers.
 *
 * RTDB path:
 *   /users/{uid}
 *
 * ```json
 * {
 *   "users": {
 *     "{uid}": {
 *       "schemaVersion": 1,
 *       "auth": { "uid": "...", "email": "...", "displayName": "...", "photoURL": "..." },
 *       "role": "pwd | caregiver | both",
 *       "identity": {
 *         "fullName": "Jane Doe",
 *         "dateOfBirth": "1998-04-12 | null",
 *         "gender": "female | male | nonbinary | prefer_not_to_say | null",
 *         "phone": "+2547... | null",
 *         "county": "Nairobi",
 *         "languages": ["English", "Kiswahili", "KSL"]
 *       },
 *       "disability": {
 *         "types": ["visual", "hearing", ...],
 *         "otherDetail": "string | null",
 *         "assistiveTech": ["Screen reader", ...],
 *         "accessNeeds": ["step_free", "csl_asl", ...],
 *         "communicationModes": ["written", "sign_language", ...],
 *         "supportNeeds": "Free text | null"
 *       },
 *       "caregiving": {
 *         "isCaregiver": true,
 *         "relationship": "Parent | null",
 *         "careRecipientName": "... | null",
 *         "authorizationNote": "... | null"
 *       },
 *       "emergencyContact": { "name": "...", "phone": "...", "relationship": "... | null" },
 *       "verification": {
 *         "method": "ncpwd_card | medical_assessment | disability_certificate | device_prescription | caregiver_letter | self_declaration",
 *         "referenceNumber": "string | null",
 *         "document": { "name": "...", "contentType": "...", "size": 123, "storagePath": "...", "downloadURL": "..." } | null,
 *         "attestAccurate": true,
 *         "consentContact": true,
 *         "status": "pending_review | self_declared | verified",
 *         "submittedAt": "ISO string"
 *       },
 *       "preferences": {
 *         "opportunityInterests": ["job", "event", "grant", "training", "public"],
 *         "workModes": ["remote", "hybrid", "onsite"],
 *         "emailUpdates": true
 *       },
 *       "meta": { "createdAt": {".sv": "timestamp"}, "updatedAt": "ISO", "completedAt": "ISO | null", "profileComplete": true }
 *     }
 *   }
 * }
 *
 * Storage layout:
 *   verification-docs/{uid}/{timestamp}-{safeFilename}
 */

export const SCHEMA_VERSION = 1;
export const USERS_PATH = 'users';
export const VERIFICATION_STORAGE_DIR = 'verification-docs';
export const MAX_VERIFICATION_BYTES = 10 * 1024 * 1024;
export const ACCEPTED_VERIFICATION_TYPES = [
  'application/pdf',
  'image/png',
  'image/jpeg',
  'image/webp',
];

export const ROLE_OPTIONS = [
  { value: 'pwd', icon: 'accessibility_new', label: 'Person with a disability', hint: 'I am signing up for myself' },
  { value: 'caregiver', icon: 'volunteer_activism', label: 'Caregiver / guardian', hint: 'I support someone with a disability' },
  { value: 'both', icon: 'group', label: 'Both', hint: 'I have a disability and I give care' },
];

export const DISABILITY_TYPE_OPTIONS = [
  { value: 'visual', icon: 'visibility', label: 'Visual / blindness / low vision' },
  { value: 'hearing', icon: 'hearing', label: 'Deaf / hard of hearing' },
  { value: 'mobility', icon: 'accessible', label: 'Mobility / physical' },
  { value: 'intellectual', icon: 'psychology', label: 'Intellectual / developmental' },
  { value: 'psychosocial', icon: 'self_improvement', label: 'Psychosocial / mental health' },
  { value: 'neurological', icon: 'neurology', label: 'Neurological (epilepsy, CP…)' },
  { value: 'chronic', icon: 'monitor_heart', label: 'Chronic illness / health condition' },
  { value: 'speech', icon: 'record_voice_over', label: 'Speech / communication' },
  { value: 'albinism', icon: 'light_mode', label: 'Albinism' },
  { value: 'multiple', icon: 'diversity_3', label: 'Multiple disabilities' },
  { value: 'other', icon: 'more_horiz', label: 'Other / prefer to describe' },
];

export const ASSISTIVE_TECH_OPTIONS = [
  'Screen reader (NVDA / JAWS / VoiceOver)',
  'Screen magnifier',
  'Hearing aid / cochlear implant',
  'Sign language interpreter',
  'CART / live captions',
  'Wheelchair / mobility aid',
  'White cane / navigation aid',
  'Braille display / materials',
  'Speech-to-text / voice control',
  'Alternative input device',
  'None yet — I need guidance',
];

export const ACCESS_NEED_OPTIONS = [
  { value: 'screen_reader', icon: 'visibility', label: 'Screen-reader compatible materials' },
  { value: 'step_free', icon: 'accessible', label: 'Step-free venues & transport' },
  { value: 'sign_asl', icon: 'sign_language', label: 'KSL / ASL interpretation' },
  { value: 'captions', icon: 'subtitles', label: 'Captions / transcripts' },
  { value: 'quiet', icon: 'volume_off', label: 'Quiet / low-sensory space' },
  { value: 'flexible', icon: 'schedule', label: 'Flexible hours / rest breaks' },
  { value: 'remote', icon: 'home_work', label: 'Remote participation option' },
  { value: 'plain', icon: 'translate', label: 'Easy-read / plain language' },
];

export const COMMUNICATION_OPTIONS = [
  'Written text / email',
  'Phone / voice call',
  'Video call',
  'Kenyan Sign Language (KSL)',
  'American Sign Language (ASL)',
  'SMS / WhatsApp',
  'Through my caregiver',
];

export const VERIFICATION_METHODS = [
  {
    value: 'ncpwd_card',
    icon: 'id_card',
    label: 'NCPWD disability card',
    hint: 'National Council for Persons with Disabilities card',
    needsDoc: true,
  },
  {
    value: 'medical_assessment',
    icon: 'clinical_notes',
    label: 'Medical assessment report',
    hint: 'Signed by a registered medical practitioner',
    needsDoc: true,
  },
  {
    value: 'disability_certificate',
    icon: 'workspace_premium',
    label: 'Disability certificate / letter',
    hint: 'Government, hospital or DPO-issued letter',
    needsDoc: true,
  },
  {
    value: 'device_prescription',
    icon: 'hearing_aid',
    label: 'Assistive-device prescription',
    hint: 'E.g. hearing aid, wheelchair, white cane prescription',
    needsDoc: true,
  },
  {
    value: 'caregiver_letter',
    icon: 'family_restroom',
    label: 'Caregiver authorization letter',
    hint: 'Proof you are authorized to act for someone',
    needsDoc: true,
  },
  {
    value: 'self_declaration',
    icon: 'edit_note',
    label: 'Self-declaration (no document yet)',
    hint: 'Create your profile now, verify later',
    needsDoc: false,
  },
];

export const INTEREST_OPTIONS = [
  { value: 'job', icon: 'work', label: 'Jobs' },
  { value: 'event', icon: 'event', label: 'Events' },
  { value: 'grant', icon: 'payments', label: 'Grants' },
  { value: 'training', icon: 'school', label: 'Training' },
  { value: 'public', icon: 'campaign', label: 'Aid & programs' },
];

export const WORK_MODE_OPTIONS = [
  { value: 'remote', icon: 'home_work', label: 'Remote' },
  { value: 'hybrid', icon: 'sync_alt', label: 'Hybrid' },
  { value: 'onsite', icon: 'location_on', label: 'On-site' },
];

export const KENYA_COUNTIES = [
  'Baringo', 'Bomet', 'Bungoma', 'Busia', 'Elgeyo-Marakwet', 'Embu', 'Garissa',
  'Homa Bay', 'Isiolo', 'Kajiado', 'Kakamega', 'Kericho', 'Kiambu', 'Kilifi',
  'Kirinyaga', 'Kisii', 'Kisumu', 'Kitui', 'Kwale', 'Laikipia', 'Lamu', 'Machakos',
  'Makueni', 'Mandera', 'Marsabit', 'Meru', 'Migori', 'Mombasa', 'Murang’a',
  'Nairobi', 'Nakuru', 'Nandi', 'Narok', 'Nyamira', 'Nyandarua', 'Nyeri',
  'Samburu', 'Siaya', 'Taita-Taveta', 'Tana River', 'Tharaka-Nithi',
  'Trans Nzoia', 'Turkana', 'Uasin Gishu', 'Vihiga', 'Wajir', 'West Pokot',
];

export const LANGUAGE_OPTIONS = ['English', 'Kiswahili', 'KSL', 'ASL', 'French', 'Somali', 'Other'];

export const INITIAL_PROFILE_FORM = {
  role: 'pwd',
  fullName: '',
  dateOfBirth: '',
  gender: '',
  phone: '',
  county: '',
  languages: ['English'],
  disabilityTypes: [],
  otherDisabilityDetail: '',
  assistiveTech: [],
  accessNeeds: [],
  communicationModes: ['Written text / email'],
  supportNeeds: '',
  isCaregiverActive: false,
  caregiverRelationship: '',
  careRecipientName: '',
  caregiverAuthorizationNote: '',
  emergencyName: '',
  emergencyPhone: '',
  emergencyRelationship: '',
  verificationMethod: 'ncpwd_card',
  verificationReference: '',
  attestAccurate: false,
  consentContact: false,
  opportunityInterests: ['job', 'event', 'grant'],
  workModes: ['remote'],
  emailUpdates: true,
};

const PHONE_REGEX = /^\+?[\d\s()|-]{7,20}$/;

function sanitizeFileName(name) {
  return String(name || 'document')
    .split('/')
    .pop()
    .replace(/[^a-zA-Z0-9._-]+/g, '_')
    .slice(0, 100);
}

export function assertVerificationFileValid(file) {
  const extOk = /\.(pdf|png|jpe?g|webp)$/i.test(file?.name || '');
  const typeOk = file?.type ? ACCEPTED_VERIFICATION_TYPES.includes(file.type) : extOk;
  if (!typeOk) throw new Error('Verification document must be a PDF, PNG, JPG or WEBP file.');
  if (file.size > MAX_VERIFICATION_BYTES) throw new Error('Verification document must be 10MB or smaller.');
}

export async function uploadVerificationDocument(uid, file) {
  if (!uid) throw new Error('You must be signed in to upload a document.');
  assertVerificationFileValid(file);
  const safeName = sanitizeFileName(file.name);
  const storagePath = `${VERIFICATION_STORAGE_DIR}/${uid}/${Date.now()}-${safeName}`;
  const fileRef = storageRef(storage, storagePath);
  await uploadBytes(fileRef, file, { contentType: file.type || 'application/octet-stream' });
  const downloadURL = await getDownloadURL(fileRef);
  return { name: file.name, contentType: file.type || null, size: file.size, storagePath, downloadURL };
}

/** Validate identity + personalization fields (steps 2). Returns errors map. */
export function validateIdentityStep(values) {
  const errors = {};
  if (!values.fullName || String(values.fullName).trim().length < 2) {
    errors.fullName = 'Enter your full name (at least 2 characters).';
  }
  if (!['pwd', 'caregiver', 'both'].includes(values.role)) errors.role = 'Choose who this profile is for.';
  if (values.dateOfBirth) {
    const d = new Date(`${values.dateOfBirth}T00:00:00`);
    if (Number.isNaN(d.getTime()) || d > new Date()) errors.dateOfBirth = 'Enter a valid date of birth in the past.';
  }
  if (values.phone && !PHONE_REGEX.test(String(values.phone).trim())) {
    errors.phone = 'Enter a valid phone number, e.g. +254 700 000 000.';
  }
  if (!values.county) errors.county = 'Select your county / location.';
  if (!Array.isArray(values.languages) || values.languages.length === 0) {
    errors.languages = 'Select at least one language.';
  }
  return errors;
}

/** Validate disability + access-needs fields (step 3). */
export function validateAccessStep(values, isCaregiverOnly) {
  const errors = {};
  if (isCaregiverOnly) return errors; // caregivers may skip disability detail
  if (!Array.isArray(values.disabilityTypes) || values.disabilityTypes.length === 0) {
    errors.disabilityTypes = 'Select at least one disability type so we can personalize for you.';
  }
  if (Array.isArray(values.disabilityTypes) && values.disabilityTypes.includes('other') && !String(values.otherDisabilityDetail || '').trim()) {
    errors.otherDisabilityDetail = 'Briefly describe your disability.';
  }
  if (!Array.isArray(values.accessNeeds) || values.accessNeeds.length === 0) {
    errors.accessNeeds = 'Pick at least one access need — this powers your filters.';
  }
  if (!Array.isArray(values.communicationModes) || values.communicationModes.length === 0) {
    errors.communicationModes = 'Choose at least one preferred communication mode.';
  }
  return errors;
}

/** Validate verification + consent fields (step 4). */
export function validateVerificationStep(values, verificationFile, existingDoc) {
  const errors = {};
  const method = VERIFICATION_METHODS.find((m) => m.value === values.verificationMethod);
  if (!method) errors.verificationMethod = 'Choose how you want to verify.';
  else if (method.needsDoc && !verificationFile && !existingDoc) {
    errors.verificationDocument = 'Upload a photo or PDF of this document so our team can verify you.';
  }
  if (verificationFile) {
    try {
      assertVerificationFileValid(verificationFile);
    } catch (e) {
      errors.verificationDocument = e.message;
    }
  }
  if (!values.emergencyName || String(values.emergencyName).trim().length < 2) {
    errors.emergencyName = 'Add an emergency contact name.';
  }
  if (!PHONE_REGEX.test(String(values.emergencyPhone || '').trim())) {
    errors.emergencyPhone = 'Add a valid emergency contact phone number.';
  }
  if (!values.attestAccurate) errors.attestAccurate = 'Please confirm your details are accurate.';
  if (!values.consentContact) errors.consentContact = 'Please consent so we can contact you about verification.';
  if (values.role !== 'pwd' && !String(values.careRecipientName || '').trim()) {
    errors.careRecipientName = 'Enter the name of the person you care for.';
  }
  return errors;
}

export function buildProfilePayload(uid, authUser, values, verificationDoc = null) {
  const method = values.verificationMethod || 'self_declaration';
  const status = method === 'self_declaration' ? 'self_declared' : verificationDoc ? 'pending_review' : 'self_declared';
  const caregiverActive = values.role !== 'pwd';
  return {
    schemaVersion: SCHEMA_VERSION,
    auth: {
      uid,
      email: authUser?.email || null,
      displayName: authUser?.displayName || null,
      photoURL: authUser?.photoURL || null,
    },
    role: values.role,
    identity: {
      fullName: String(values.fullName || '').trim(),
      dateOfBirth: values.dateOfBirth || null,
      gender: values.gender || null,
      phone: String(values.phone || '').trim() || null,
      county: values.county || null,
      languages: Array.isArray(values.languages) ? values.languages : [],
    },
    disability: {
      types: Array.isArray(values.disabilityTypes) ? values.disabilityTypes : [],
      otherDetail: String(values.otherDisabilityDetail || '').trim() || null,
      assistiveTech: Array.isArray(values.assistiveTech) ? values.assistiveTech : [],
      accessNeeds: Array.isArray(values.accessNeeds) ? values.accessNeeds : [],
      communicationModes: Array.isArray(values.communicationModes) ? values.communicationModes : [],
      supportNeeds: String(values.supportNeeds || '').trim() || null,
    },
    caregiving: {
      isCaregiver: caregiverActive,
      relationship: String(values.caregiverRelationship || '').trim() || null,
      careRecipientName: String(values.careRecipientName || '').trim() || null,
      authorizationNote: String(values.caregiverAuthorizationNote || '').trim() || null,
    },
    emergencyContact: {
      name: String(values.emergencyName || '').trim(),
      phone: String(values.emergencyPhone || '').trim(),
      relationship: String(values.emergencyRelationship || '').trim() || null,
    },
    verification: {
      method,
      referenceNumber: String(values.verificationReference || '').trim() || null,
      document: verificationDoc,
      attestAccurate: Boolean(values.attestAccurate),
      consentContact: Boolean(values.consentContact),
      status,
      submittedAt: new Date().toISOString(),
    },
    preferences: {
      opportunityInterests: Array.isArray(values.opportunityInterests) ? values.opportunityInterests : [],
      workModes: Array.isArray(values.workModes) ? values.workModes : [],
      emailUpdates: Boolean(values.emailUpdates),
    },
    meta: {
      createdAt: serverTimestamp(),
      updatedAt: new Date().toISOString(),
      completedAt: new Date().toISOString(),
      profileComplete: true,
    },
  };
}

export async function saveUserProfile(uid, authUser, values, verificationFile, existingDoc = null) {
  if (!uid) throw new Error('You must be signed in with Google first.');
  let doc = existingDoc || null;
  if (verificationFile) doc = await uploadVerificationDocument(uid, verificationFile);
  const payload = buildProfilePayload(uid, authUser, values, doc);
  // Preserve original createdAt on re-save.
  try {
    const snap = await get(dbRef(db, `${USERS_PATH}/${uid}`));
    if (snap.exists() && snap.val()?.meta?.createdAt) {
      payload.meta.createdAt = snap.val().meta.createdAt;
    }
  } catch {
    // First-time save — serverTimestamp stands.
  }
  await set(dbRef(db, `${USERS_PATH}/${uid}`), payload);
  return payload;
}

export async function fetchUserProfile(uid) {
  if (!uid) return null;
  const snap = await get(dbRef(db, `${USERS_PATH}/${uid}`));
  if (!snap.exists()) return null;
  return { id: uid, ...snap.val() };
}

export function profileToFormValues(profile) {
  if (!profile) return { ...INITIAL_PROFILE_FORM };
  const form = { ...INITIAL_PROFILE_FORM };
  form.role = ['pwd', 'caregiver', 'both'].includes(profile.role) ? profile.role : 'pwd';
  form.fullName = profile.identity?.fullName || profile.auth?.displayName || '';
  form.dateOfBirth = profile.identity?.dateOfBirth || '';
  form.gender = profile.identity?.gender || '';
  form.phone = profile.identity?.phone || '';
  form.county = profile.identity?.county || '';
  form.languages = profile.identity?.languages?.length ? profile.identity.languages : ['English'];
  form.disabilityTypes = profile.disability?.types || [];
  form.otherDisabilityDetail = profile.disability?.otherDetail || '';
  form.assistiveTech = profile.disability?.assistiveTech || [];
  form.accessNeeds = profile.disability?.accessNeeds || [];
  form.communicationModes = profile.disability?.communicationModes?.length
    ? profile.disability.communicationModes
    : ['Written text / email'];
  form.supportNeeds = profile.disability?.supportNeeds || '';
  form.caregiverRelationship = profile.caregiving?.relationship || '';
  form.careRecipientName = profile.caregiving?.careRecipientName || '';
  form.caregiverAuthorizationNote = profile.caregiving?.authorizationNote || '';
  form.emergencyName = profile.emergencyContact?.name || '';
  form.emergencyPhone = profile.emergencyContact?.phone || '';
  form.emergencyRelationship = profile.emergencyContact?.relationship || '';
  form.verificationMethod = profile.verification?.method || 'ncpwd_card';
  form.verificationReference = profile.verification?.referenceNumber || '';
  form.opportunityInterests = profile.preferences?.opportunityInterests?.length
    ? profile.preferences.opportunityInterests
    : ['job', 'event', 'grant'];
  form.workModes = profile.preferences?.workModes?.length ? profile.preferences.workModes : ['remote'];
  form.emailUpdates = profile.preferences?.emailUpdates !== false;
  return form;
}

const DRAFT_KEY = 'accessable.profileDraft.v1';

export function readDraft() {
  try {
    const raw = localStorage.getItem(DRAFT_KEY);
    if (!raw) return null;
    return JSON.parse(raw);
  } catch {
    return null;
  }
}

export function writeDraft(values) {
  try {
    localStorage.setItem(DRAFT_KEY, JSON.stringify(values));
  } catch {
    // best-effort
  }
}

export function clearDraft() {
  try {
    localStorage.removeItem(DRAFT_KEY);
  } catch {
    // best-effort
  }
}
