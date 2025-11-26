const mongoose = require('mongoose');
const bcrypt = require('bcryptjs');

/**
 * User Schema for all system users (Patient, Doctor, Hospital, Admin)
 */
const userSchema = new mongoose.Schema({
  name: {
    type: String,
    required: [true, 'Name is required'],
    trim: true,
    maxlength: [100, 'Name cannot exceed 100 characters']
  },
  email: {
    type: String,
    required: [true, 'Email is required'],
    unique: true,
    lowercase: true,
    match: [/^\w+([.-]?\w+)*@\w+([.-]?\w+)*(\.\w{2,3})+$/, 'Please enter a valid email']
  },
  password: {
    type: String,
    required: [true, 'Password is required'],
    minlength: [6, 'Password must be at least 6 characters'],
    select: false // Don't include password in queries by default
  },
  role: {
    type: String,
    required: [true, 'Role is required'],
    enum: ['patient', 'doctor', 'hospital', 'admin'],
    default: 'patient'
  },
  approved: {
    type: Boolean,
    default: function() {
      // Auto-approve patients and admins, require approval for doctors and hospitals
      return this.role === 'patient' || this.role === 'admin';
    }
  },
  profileData: {
    // Additional role-specific data
    specialization: String, // For doctors
    licenseNumber: String, // For doctors and hospitals
    hospitalId: { // For doctors associated with hospitals
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User'
    },
    address: String,
    phone: String,
    dateOfBirth: Date, // For patients
    emergencyContact: {
      name: String,
      phone: String,
      relationship: String
    }
  },
  isActive: {
    type: Boolean,
    default: true
  },
  lastLogin: {
    type: Date
  },
  otp: {
    type: String,
    select: false // Don't include in queries by default
  },
  otpExpires: {
    type: Date,
    select: false
  },
  createdAt: {
    type: Date,
    default: Date.now
  },
  updatedAt: {
    type: Date,
    default: Date.now
  }
});

// Index for better query performance
userSchema.index({ email: 1, role: 1 });
userSchema.index({ approved: 1, role: 1 });

// Update the updatedAt field before saving
userSchema.pre('save', function(next) {
  this.updatedAt = Date.now();
  next();
});

// Hash password before saving
userSchema.pre('save', async function(next) {
  // Only hash the password if it has been modified (or is new)
  if (!this.isModified('password')) return next();
  
  try {
    // Hash password with cost of 12
    const salt = await bcrypt.genSalt(12);
    this.password = await bcrypt.hash(this.password, salt);
    next();
  } catch (error) {
    next(error);
  }
});

// Instance method to check password
userSchema.methods.comparePassword = async function(candidatePassword) {
  try {
    return await bcrypt.compare(candidatePassword, this.password);
  } catch (error) {
    throw new Error('Password comparison failed');
  }
};

// Instance method to get public profile (without sensitive data)
userSchema.methods.getPublicProfile = function() {
  const userObject = this.toObject();
  delete userObject.password;
  return userObject;
};

// Static method to find users by role
userSchema.statics.findByRole = function(role, includeInactive = false) {
  const query = { role };
  if (!includeInactive) {
    query.isActive = true;
  }
  return this.find(query);
};

// Static method to find pending approvals
userSchema.statics.findPendingApprovals = function() {
  return this.find({ 
    approved: false, 
    isActive: true,
    role: { $in: ['doctor', 'hospital'] }
  });
};

// Virtual for full name (if needed in the future)
userSchema.virtual('fullName').get(function() {
  return this.name;
});

// Ensure virtual fields are serialized
userSchema.set('toJSON', {
  virtuals: true,
  transform: function(doc, ret) {
    delete ret.password;
    return ret;
  }
});

module.exports = mongoose.model('User', userSchema);
