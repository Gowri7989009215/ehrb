const express = require('express');
const router = express.Router();
const { authenticate, authorize, logAccess } = require('../middleware/authMiddleware');
const {
  uploadRecord,
  getRecords,
  getRecordContent,
  getProfile,
  updateProfile,
  grantConsent,
  revokeConsent,
  getConsents,
  getAuditTrail,
  getDashboard
} = require('../controllers/patientController');

// Apply authentication and patient role authorization to all routes
router.use(authenticate);
router.use(authorize('patient'));

/**
 * @route   GET /api/patient/dashboard
 * @desc    Get patient dashboard data
 * @access  Private (Patient only)
 */
router.get('/dashboard', logAccess('DASHBOARD_VIEW'), getDashboard);

/**
 * @route   GET /api/patient/profile
 * @desc    Get patient profile
 * @access  Private (Patient only)
 */
router.get('/profile', logAccess('PROFILE_VIEW'), getProfile);

/**
 * @route   PUT /api/patient/profile
 * @desc    Update patient profile
 * @access  Private (Patient only)
 */
router.put('/profile', logAccess('PROFILE_UPDATE'), updateProfile);

/**
 * @route   POST /api/patient/upload
 * @desc    Upload encrypted medical record
 * @access  Private (Patient only)
 */
router.post('/upload', logAccess('RECORD_UPLOAD'), uploadRecord);

/**
 * @route   GET /api/patient/records
 * @desc    Get patient's medical records
 * @access  Private (Patient only)
 */
router.get('/records', logAccess('RECORD_VIEW'), getRecords);

/**
 * @route   GET /api/patient/record/:recordId/content
 * @desc    Get decrypted record content
 * @access  Private (Patient only)
 */
router.get('/record/:recordId/content', logAccess('RECORD_VIEW'), getRecordContent);

/**
 * @route   POST /api/patient/grant-consent
 * @desc    Grant consent to a doctor
 * @access  Private (Patient only)
 */
router.post('/grant-consent', logAccess('CONSENT_GRANT'), grantConsent);

/**
 * @route   POST /api/patient/revoke-consent
 * @desc    Revoke consent from a doctor
 * @access  Private (Patient only)
 */
router.post('/revoke-consent', logAccess('CONSENT_REVOKE'), revokeConsent);

/**
 * @route   GET /api/patient/consents
 * @desc    Get patient's consent history
 * @access  Private (Patient only)
 */
router.get('/consents', logAccess('CONSENT_VIEW'), getConsents);

/**
 * @route   GET /api/patient/audit
 * @desc    Get patient's audit trail
 * @access  Private (Patient only)
 */
router.get('/audit', logAccess('AUDIT_VIEW'), getAuditTrail);

module.exports = router;
