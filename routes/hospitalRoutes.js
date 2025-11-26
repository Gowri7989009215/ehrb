const express = require('express');
const router = express.Router();
const { authenticate, authorize, requireApproval, logAccess } = require('../middleware/authMiddleware');
const {
  addDoctor,
  removeDoctor,
  getDoctors,
  storeRecord,
  getStoredRecords,
  searchPatients,
  getDashboard
} = require('../controllers/hospitalController');

// Apply authentication and hospital role authorization to all routes
router.use(authenticate);
router.use(authorize('hospital'));
router.use(requireApproval); // Hospitals must be approved

/**
 * @route   GET /api/hospital/dashboard
 * @desc    Get hospital dashboard data
 * @access  Private (Hospital only)
 */
router.get('/dashboard', logAccess('DASHBOARD_VIEW'), getDashboard);

/**
 * @route   POST /api/hospital/add-doctor
 * @desc    Add a doctor to the hospital
 * @access  Private (Hospital only)
 */
router.post('/add-doctor', logAccess('USER_UPDATE'), addDoctor);

/**
 * @route   DELETE /api/hospital/doctor/:doctorId
 * @desc    Remove a doctor from the hospital
 * @access  Private (Hospital only)
 */
router.delete('/doctor/:doctorId', logAccess('USER_UPDATE'), removeDoctor);

/**
 * @route   GET /api/hospital/doctors
 * @desc    Get hospital's doctors
 * @access  Private (Hospital only)
 */
router.get('/doctors', logAccess('USER_VIEW'), getDoctors);

/**
 * @route   POST /api/hospital/store-record
 * @desc    Store patient record (lab results, discharge summary, etc.)
 * @access  Private (Hospital only)
 */
router.post('/store-record', logAccess('RECORD_UPLOAD'), storeRecord);

/**
 * @route   GET /api/hospital/records
 * @desc    Get hospital's stored records
 * @access  Private (Hospital only)
 */
router.get('/records', logAccess('RECORD_VIEW'), getStoredRecords);

/**
 * @route   GET /api/hospital/search-patients
 * @desc    Search for patients
 * @access  Private (Hospital only)
 */
router.get('/search-patients', logAccess('USER_VIEW'), searchPatients);

module.exports = router;
