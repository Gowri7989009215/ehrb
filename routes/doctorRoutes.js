const express = require('express');
const router = express.Router();
const { authenticate, authorize, requireApproval, logAccess } = require('../middleware/authMiddleware');
const {
  requestAccess,
  getPatientRecords,
  getRecordContent,
  addRecordUpdate,
  getActiveConsents,
  getDashboard,
  getActivityLog
} = require('../controllers/doctorController');

// Apply authentication and doctor role authorization to all routes
router.use(authenticate);
router.use(authorize('doctor'));
router.use(requireApproval); // Doctors must be approved

/**
 * @route   GET /api/doctor/dashboard
 * @desc    Get doctor dashboard data
 * @access  Private (Doctor only, approved)
 */
router.get('/dashboard', logAccess('DASHBOARD_VIEW'), getDashboard);

/**
 * @route   GET /api/doctor/activity-log
 * @desc    Get doctor activity log
 * @access  Private (Doctor only, approved)
 */
router.get('/activity-log', logAccess('ACTIVITY_LOG_VIEW'), getActivityLog);

/**
 * @route   POST /api/doctor/request-access
 * @desc    Request access to patient records
 * @access  Private (Doctor only)
 */
router.post('/request-access', logAccess('CONSENT_REQUEST'), requestAccess);
/**
 * @route   GET /api/doctor/records/:patientId
 * @desc    Get patient records (with consent validation)
 * @access  Private (Doctor only)
 */
router.get('/records/:patientId', logAccess('RECORD_VIEW'), getPatientRecords);

/**
 * @route   GET /api/doctor/record/:recordId/content
 * @desc    Get decrypted record content
 * @access  Private (Doctor only)
 */
router.get('/record/:recordId/content', logAccess('RECORD_VIEW'), getRecordContent);

/**
 * @route   POST /api/doctor/records/:patientId/update
 * @desc    Add notes or update to a patient record
 * @access  Private (Doctor only)
 */
router.post('/records/:patientId/update', logAccess('RECORD_UPDATE'), addRecordUpdate);

/**
 * @route   GET /api/doctor/consents
 * @desc    Get doctor's active consents
 * @access  Private (Doctor only)
 */
router.get('/consents', logAccess('CONSENT_VIEW'), getActiveConsents);

module.exports = router;
