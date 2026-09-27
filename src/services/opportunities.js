import {
  get,
  onValue,
  push,
  ref as dbRef,
  remove,
  serverTimestamp,
  set,
} from 'firebase/database';
import {
  deleteObject,
  getDownloadURL,
  ref as storageRef,
  uploadBytes,
} from 'firebase/storage';
import { db, storage } from '../firebase';

/**
 * Firebase RTDB schema for AccessAble opportunities.
 *
 * RTDB path:
 *   /opportunities/{opportunityId}
 *
 * ```json
 * {
 *   "opportunities": {
 *     "-Oabc123...": {
 *       "schemaVersion": 1,
 *       "status": "pending_review",
 *       "basic": {
 *         "title": "Senior Accessibility Engineer (Remote)",
 *         "category": "job | event | grant | training | aid (legacy 'public' reads as 'aid')",
 *         "organization": {
 *           "name": "Kenya Inclusive Tech Trust",
 *           "website": "https://example.org | null",
 *           "logo": {
 *             "name": "logo.png",
 *             "contentType": "image/png",
 *             "size": 12345,
 *             "storagePath": "opportunity-logos/{opportunityId}/1693-logo.png",
 *             "downloadURL": "https://firebasestorage.googleapis.com/..."
 *           } | null
 *         }
 *       },
 *       "logistics": {
 *         "deliveryMode": "remote | onsite | hybrid",
 *         "venueAddress": "string | null (required unless remote)",
 *         "applicationDeadline": "YYYY-MM-DD",
 *         "startDate": "YYYY-MM-DD | null",
 *         "compensation": "string | null"
 *       },
 *       "accessibility": {
 *         "features": {
 *           "mobility_restrooms": true,
 *           "mobility_stepfree": true,
 *           "mobility_parking": false,
 *           "sli_support": true,
 *           "cart_captions": true,
 *           "hearing_loop": false,
 *           "screen_reader_docs": true,
 *           "braille_materials": false,
 *           "audio_descriptions": true,
 *           "quiet_room": false,
 *           "pre_agenda": false,
 *           "camera_optional": false
 *         },
 *         "notes": {
 *           "mobility": "string | null",
 *           "hearing": "string | null",
 *           "vision": "string | null",
 *           "sensory": "string | null"
 *         },
 *         "coordinator": {
 *           "name": "Grace M., DEI Officer",
 *           "contact": "accommodations@org.or.ke",
 *           "noticePeriod": "At least 3 business days"
 *         }
 *       },
 *       "details": {
 *         "descriptionMarkdown": "Full markdown description...",
 *         "applicationUrl": "https://...",
 *         "multimodalSupport": true,
 *         "pledgeAccepted": true
 *       },
 *       "meta": {
 *         "createdAt": { ".sv": "timestamp" },
 *         "submittedAt": "2026-09-22T10:00:00.000Z"
 *       }
 *     }
 *   }
 * }
 * ```
 *
 * Firebase Storage layout:
 *   opportunity-logos/{opportunityId}/{timestamp}-{safeFilename}
 * Only the file metadata + downloadURL are stored in RTDB. Never store
 * base64/dataURLs in RTDB (10MB write limit, slow reads, high cost).
 */

export const SCHEMA_VERSION = 1;
export const OPPORTUNITIES_PATH = 'opportunities';
export const LOGO_STORAGE_DIR = 'opportunity-logos';
export const MAX_LOGO_BYTES = 5 * 1024 * 1024;
export const ACCEPTED_LOGO_TYPES = [
  'image/svg+xml',
  'image/png',
  'image/jpeg',
];

export const ACCESSIBILITY_FEATURE_KEYS = [
  'mobility_restrooms',
  'mobility_stepfree',
  'mobility_parking',
  'sli_support',
  'cart_captions',
  'hearing_loop',
  'screen_reader_docs',
  'braille_materials',
  'audio_descriptions',
  'quiet_room',
  'pre_agenda',
  'camera_optional',
];

function trimOrNull(value) {
  const trimmed = String(value == null ? '' : value).trim();
  return trimmed === '' ? null : trimmed;
}

function trimOrEmpty(value) {
  return String(value == null ? '' : value).trim();
}

function formatDatePart(day, month, year) {
  if (!day || !month || !year) return null;
  const dd = String(day).padStart(2, '0');
  const mm = String(month).padStart(2, '0');
  return `${year}-${mm}-${dd}`;
}

function sanitizeFileName(name) {
  return String(name || 'logo')
    .split('/')
    .pop()
    .replace(/[^a-zA-Z0-9._-]+/g, '_')
    .slice(0, 100);
}

function assertLogoValid(file) {
  const extensionOk = /\.(svg|png|jpe?g)$/i.test(file?.name || '');
  const typeOk = file?.type
    ? ACCEPTED_LOGO_TYPES.includes(file.type)
    : extensionOk;
  if (!typeOk) {
    throw new Error('Logo must be an SVG, PNG, or JPG file.');
  }
  if (file.size > MAX_LOGO_BYTES) {
    throw new Error('Logo must be 5MB or smaller.');
  }
}

/**
 * Build the normalized RTDB payload from raw form values.
 * Pass `logo` separately after the Storage upload completes.
 */
/**
 * Public announcements are stored as `aid` in the database.
 * Legacy `public` values are normalized to `aid` on write.
 */
export function normalizeCategoryForDb(category) {
  if (category === 'public') return 'aid';
  return category;
}

export function buildOpportunityPayload(values, logo = null) {
  const features = {};
  ACCESSIBILITY_FEATURE_KEYS.forEach((key) => {
    features[key] = Boolean(values[key]);
  });

  return {
    schemaVersion: SCHEMA_VERSION,
    status: 'pending_review',
    basic: {
      title: trimOrEmpty(values.opportunityTitle),
      category: normalizeCategoryForDb(values.category),
      organization: {
        name: trimOrEmpty(values.orgName),
        website: trimOrNull(values.orgUrl),
        logo,
      },
    },
    logistics: {
      deliveryMode: values.deliveryMode,
      venueAddress: trimOrNull(values.venueAddress),
      applicationDeadline: formatDatePart(
        values.deadlineDay,
        values.deadlineMonth,
        values.deadlineYear
      ),
      startDate: formatDatePart(
        values.startDay,
        values.startMonth,
        values.startYear
      ),
      compensation: trimOrNull(values.compensation),
    },
    accessibility: {
      features,
      notes: {
        mobility: trimOrNull(values.mobilityNotes),
        hearing: trimOrNull(values.hearingNotes),
        vision: trimOrNull(values.visionNotes),
        sensory: trimOrNull(values.sensoryNotes),
      },
      coordinator: {
        name: trimOrEmpty(values.coordinatorName),
        contact: trimOrEmpty(values.coordinatorContact),
        noticePeriod: trimOrEmpty(values.coordinatorNotice),
      },
    },
    details: {
      descriptionMarkdown: trimOrEmpty(values.description),
      applicationUrl: trimOrEmpty(values.appUrl),
      multimodalSupport: Boolean(values.multimodalSupport),
      pledgeAccepted: Boolean(values.pledgeAgree),
    },
    meta: {
      createdAt: serverTimestamp(),
      submittedAt: new Date().toISOString(),
    },
  };
}

/**
 * Upload the org logo to Firebase Storage.
 * @returns {Promise<{name, contentType, size, storagePath, downloadURL}>}
 */
export async function uploadOpportunityLogo(opportunityId, file) {
  assertLogoValid(file);
  const safeName = sanitizeFileName(file.name);
  const storagePath = `${LOGO_STORAGE_DIR}/${opportunityId}/${Date.now()}-${safeName}`;
  const fileRef = storageRef(storage, storagePath);
  await uploadBytes(fileRef, file, {
    contentType: file.type || 'application/octet-stream',
  });
  const downloadURL = await getDownloadURL(fileRef);
  return {
    name: file.name,
    contentType: file.type || null,
    size: file.size,
    storagePath,
    downloadURL,
  };
}

/**
 * Submit for Review: reserves an RTDB push id, uploads the logo image to
 * Firebase Storage (if provided), then writes the full schema to
 * `/opportunities/{opportunityId}` in RTDB.
 *
 * @param {object} values - raw form values from SubmissionForm state
 * @param {File|null} logoFile - optional org logo image
 * @returns {Promise<string>} the new opportunityId (RTDB push key)
 */
export async function submitOpportunity(values, logoFile) {
  // Reserve the id first so the Storage path can include it. This keeps
  // RTDB records and Storage objects 1:1 and makes cleanup/rules trivial.
  const listRef = dbRef(db, OPPORTUNITIES_PATH);
  const newRef = push(listRef);
  const opportunityId = newRef.key;
  if (!opportunityId) {
    throw new Error('Could not generate an opportunity id.');
  }

  let logo = null;
  if (logoFile) {
    logo = await uploadOpportunityLogo(opportunityId, logoFile);
  }

  const payload = buildOpportunityPayload(values, logo);
  await set(newRef, payload);
  return opportunityId;
}

/**
 * Normalize an RTDB `/opportunities` snapshot into a flat array.
 * Each entry is `{ id, ...record }` where `record` follows the schema
 * documented at the top of this file (basic/logistics/accessibility/
 * details/meta/status/schemaVersion).
 */
export function normalizeOpportunitiesSnapshot(value) {
  if (!value || typeof value !== 'object') return [];
  return Object.entries(value).map(([id, record]) => ({
    id,
    ...(record && typeof record === 'object' ? record : {}),
  }));
}

/**
 * One-time fetch of the production list at `/opportunities`.
 * @returns {Promise<Array<{id, ...}>>} newest-first by meta.createdAt
 */
export async function fetchOpportunities() {
  const listRef = dbRef(db, OPPORTUNITIES_PATH);
  const snapshot = await get(listRef);
  const items = normalizeOpportunitiesSnapshot(
    snapshot.exists() ? snapshot.val() : null
  );
  items.sort((a, b) => (b?.meta?.createdAt || 0) - (a?.meta?.createdAt || 0));
  return items;
}

/**
 * Realtime subscription to `/opportunities`.
 * @param {(items: Array<{id, ...}>) => void} onData
 * @param {(error: Error) => void} [onError]
 * @returns {() => void} unsubscribe function
 */
export function subscribeOpportunities(onData, onError) {
  const listRef = dbRef(db, OPPORTUNITIES_PATH);
  return onValue(
    listRef,
    (snapshot) => {
      const items = normalizeOpportunitiesSnapshot(
        snapshot.exists() ? snapshot.val() : null
      );
      items.sort(
        (a, b) => (b?.meta?.createdAt || 0) - (a?.meta?.createdAt || 0)
      );
      onData(items);
    },
    (error) => {
      if (typeof onError === 'function') onError(error);
    }
  );
}

/**
 * One-time fetch of a single opportunity.
 * @returns {Promise<({id, ...} | null)>}
 */
export async function getOpportunity(opportunityId) {
  if (!opportunityId) return null;
  const snapshot = await get(dbRef(db, `${OPPORTUNITIES_PATH}/${opportunityId}`));
  if (!snapshot.exists()) return null;
  return { id: opportunityId, ...snapshot.val() };
}

/**
 * Full-replace update of `/opportunities/{id}`.
 *
 * RTDB rules validate the whole record on every write, so updates are
 * written with `set` (same shape as create). Original `meta.createdAt`,
 * `status` and the existing logo are preserved unless a new logo file is
 * provided. Logo removal is supported by passing `logoFile === null` with
 * `removeLogo === true`.
 *
 * @param {string} opportunityId
 * @param {object} values - same raw form shape as submitOpportunity
 * @param {{ logoFile?: File|null, removeLogo?: boolean }} [options]
 */
export async function updateOpportunity(opportunityId, values, options = {}) {
  if (!opportunityId) throw new Error('An opportunity id is required.');
  const { logoFile = null, removeLogo = false } = options;
  const current = await getOpportunity(opportunityId);
  if (!current) throw new Error('Opportunity not found. It may have been deleted.');

  let logo = current?.basic?.organization?.logo || null;
  if (logoFile) {
    logo = await uploadOpportunityLogo(opportunityId, logoFile);
  } else if (removeLogo) {
    logo = null;
  }

  const payload = buildOpportunityPayload(values, logo);
  payload.status = current.status || 'pending_review';
  payload.meta.createdAt = current?.meta?.createdAt || serverTimestamp();
  payload.meta.submittedAt = new Date().toISOString();
  await set(dbRef(db, `${OPPORTUNITIES_PATH}/${opportunityId}`), payload);

  // Best-effort cleanup of a replaced/removed logo object.
  const oldPath = current?.basic?.organization?.logo?.storagePath;
  if (oldPath && (!logo || logo.storagePath !== oldPath)) {
    try {
      await deleteObject(storageRef(storage, oldPath));
    } catch (error) {
      // Storage cleanup must never fail the RTDB update.
      console.warn('Could not delete replaced logo:', error);
    }
  }
  return opportunityId;
}

/**
 * Delete `/opportunities/{id}` plus its logo object (best-effort).
 */
export async function deleteOpportunity(opportunityId) {
  if (!opportunityId) throw new Error('An opportunity id is required.');
  const current = await getOpportunity(opportunityId);
  await remove(dbRef(db, `${OPPORTUNITIES_PATH}/${opportunityId}`));
  const logoPath = current?.basic?.organization?.logo?.storagePath;
  if (logoPath) {
    try {
      await deleteObject(storageRef(storage, logoPath));
    } catch (error) {
      console.warn('Could not delete opportunity logo:', error);
    }
  }
  return opportunityId;
}

export const CATEGORY_VALUES = ['job', 'event', 'grant', 'training', 'aid', 'public'];
export const DELIVERY_VALUES = ['remote', 'onsite', 'hybrid'];

/**
 * Blank raw form values compatible with buildOpportunityPayload().
 * Shared by the Home create/edit dialog so create and update stay in sync.
 */
export const INITIAL_OPPORTUNITY_FORM = {
  opportunityTitle: '',
  category: 'job',
  orgName: '',
  orgUrl: '',
  deliveryMode: 'remote',
  venueAddress: '',
  deadlineDay: '',
  deadlineMonth: '',
  deadlineYear: '',
  startDay: '',
  startMonth: '',
  startYear: '',
  compensation: '',
  mobility_restrooms: false,
  mobility_stepfree: false,
  mobility_parking: false,
  sli_support: false,
  cart_captions: false,
  hearing_loop: false,
  screen_reader_docs: false,
  braille_materials: false,
  audio_descriptions: false,
  quiet_room: false,
  pre_agenda: false,
  camera_optional: false,
  mobilityNotes: '',
  hearingNotes: '',
  visionNotes: '',
  sensoryNotes: '',
  coordinatorName: '',
  coordinatorContact: '',
  coordinatorNotice: 'At least 3 business days',
  description: '',
  appUrl: '',
  multimodalSupport: false,
  pledgeAgree: false,
};

function splitIsoDate(isoDate) {
  if (!isoDate || typeof isoDate !== 'string') {
    return { day: '', month: '', year: '' };
  }
  const [year = '', month = '', day = ''] = isoDate.split('-');
  return { day, month, year };
}

/**
 * Convert a stored RTDB record back into raw form values for editing.
 */
export function opportunityToFormValues(opportunity) {
  const deadline = splitIsoDate(opportunity?.logistics?.applicationDeadline);
  const start = splitIsoDate(opportunity?.logistics?.startDate);
  const features = opportunity?.accessibility?.features || {};
  const notes = opportunity?.accessibility?.notes || {};
  const coordinator = opportunity?.accessibility?.coordinator || {};
  const form = { ...INITIAL_OPPORTUNITY_FORM };
  form.opportunityTitle = opportunity?.basic?.title || '';
  if (opportunity?.basic?.category === 'public') {
    // Legacy records stored as 'public' are surfaced as 'aid'.
    form.category = 'aid';
  } else {
    form.category = CATEGORY_VALUES.includes(opportunity?.basic?.category)
      ? opportunity.basic.category
      : 'job';
  }
  form.orgName = opportunity?.basic?.organization?.name || '';
  form.orgUrl = opportunity?.basic?.organization?.website || '';
  form.deliveryMode = DELIVERY_VALUES.includes(opportunity?.logistics?.deliveryMode)
    ? opportunity.logistics.deliveryMode
    : 'remote';
  form.venueAddress = opportunity?.logistics?.venueAddress || '';
  form.deadlineDay = deadline.day;
  form.deadlineMonth = deadline.month;
  form.deadlineYear = deadline.year;
  form.startDay = start.day;
  form.startMonth = start.month;
  form.startYear = start.year;
  form.compensation = opportunity?.logistics?.compensation || '';
  ACCESSIBILITY_FEATURE_KEYS.forEach((key) => {
    form[key] = features[key] === true;
  });
  form.mobilityNotes = notes.mobility || '';
  form.hearingNotes = notes.hearing || '';
  form.visionNotes = notes.vision || '';
  form.sensoryNotes = notes.sensory || '';
  form.coordinatorName = coordinator.name || '';
  form.coordinatorContact = coordinator.contact || '';
  form.coordinatorNotice = coordinator.noticePeriod || '';
  form.description = opportunity?.details?.descriptionMarkdown || '';
  form.appUrl = opportunity?.details?.applicationUrl || '';
  form.multimodalSupport = opportunity?.details?.multimodalSupport === true;
  // The pledge must be re-affirmed on every edit.
  form.pledgeAgree = false;
  return form;
}

const HTTP_URL_REGEX = /^https?:\/\/.+\..+/i;
const CONTACT_REGEX = /^[^\s@]+@[^\s@]+\.[^\s@]+$|^\+?[\d\s()|-]{7,}$/;

function isValidCalendarDate(day, month, year) {
  const d = Number(day);
  const m = Number(month);
  const y = Number(year);
  if (!Number.isInteger(d) || !Number.isInteger(m) || !Number.isInteger(y)) return false;
  if (y < 1900 || y > 2100 || m < 1 || m > 12 || d < 1 || d > 31) return false;
  const date = new Date(y, m - 1, d);
  return date.getFullYear() === y && date.getMonth() === m - 1 && date.getDate() === d;
}

/**
 * Validate raw form values for create/update. Returns an errors object
 * keyed by field (empty = valid). Mirrors database.rules.json constraints.
 */
export function validateOpportunityForm(values) {
  const errors = {};
  const title = String(values.opportunityTitle || '').trim();
  if (!title) errors.opportunityTitle = 'Enter an opportunity title.';
  else if (title.length > 120) errors.opportunityTitle = 'Title must be 120 characters or fewer.';

  if (!CATEGORY_VALUES.includes(values.category)) errors.category = 'Select a category.';
  if (!String(values.orgName || '').trim()) errors.orgName = 'Enter the organization name.';

  const orgUrl = String(values.orgUrl || '').trim();
  if (orgUrl && !HTTP_URL_REGEX.test(orgUrl)) {
    errors.orgUrl = 'Website must be a full URL starting with http(s)://.';
  }

  if (!DELIVERY_VALUES.includes(values.deliveryMode)) {
    errors.deliveryMode = 'Select a delivery mode.';
  } else if (values.deliveryMode !== 'remote' && !String(values.venueAddress || '').trim()) {
    errors.venueAddress = 'Venue address is required for on-site and hybrid listings.';
  }

  const deadlineParts = [values.deadlineDay, values.deadlineMonth, values.deadlineYear];
  if (deadlineParts.some((part) => String(part || '').trim() !== '')) {
    if (!isValidCalendarDate(values.deadlineDay, values.deadlineMonth, values.deadlineYear)) {
      errors.applicationDeadline = 'Enter a valid application deadline (DD / MM / YYYY).';
    }
  } else {
    errors.applicationDeadline = 'Enter the application deadline.';
  }

  const startParts = [values.startDay, values.startMonth, values.startYear];
  if (startParts.some((part) => String(part || '').trim() !== '')) {
    if (!isValidCalendarDate(values.startDay, values.startMonth, values.startYear)) {
      errors.startDate = 'Enter a valid start date (DD / MM / YYYY) or leave it empty.';
    }
  }

  if (!String(values.coordinatorName || '').trim()) {
    errors.coordinatorName = "Enter the accessibility coordinator's name.";
  }
  if (!CONTACT_REGEX.test(String(values.coordinatorContact || '').trim())) {
    errors.coordinatorContact = 'Enter a valid coordinator email or phone number.';
  }
  if (!String(values.description || '').trim()) {
    errors.description = 'Describe the opportunity.';
  }
  if (!HTTP_URL_REGEX.test(String(values.appUrl || '').trim())) {
    errors.appUrl = 'Application URL must start with http(s)://.';
  }
  if (!values.pledgeAgree) {
    errors.pledgeAgree = 'You must accept the inclusion pledge.';
  }
  return errors;
}
