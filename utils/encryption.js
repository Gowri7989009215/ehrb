const crypto = require('crypto');

// AES-256-GCM encryption
const ALGORITHM = 'aes-256-gcm';
const ENCRYPTION_KEY = process.env.ENCRYPTION_KEY || 'your-32-character-secret-key-here';

/**
 * Encrypt sensitive data using AES-256-GCM
 * @param {string} text - Text to encrypt
 * @returns {object} - Encrypted data with IV and authTag
 */
const encrypt = (text) => {
  try {
    const iv = crypto.randomBytes(16);
    const key = Buffer.from(ENCRYPTION_KEY.slice(0, 32), 'utf8');
    const cipher = crypto.createCipheriv(ALGORITHM, key, iv);
    cipher.setAAD(Buffer.from('EHR-System', 'utf8'));
    
    let encrypted = cipher.update(text, 'utf8', 'hex');
    encrypted += cipher.final('hex');
    
    const authTag = cipher.getAuthTag();
    
    return {
      encrypted,
      iv: iv.toString('hex'),
      authTag: authTag.toString('hex')
    };
  } catch (error) {
    throw new Error('Encryption failed: ' + error.message);
  }
};

/**
 * Decrypt data using AES-256-GCM
 * @param {object} encryptedData - Object containing encrypted text, IV, and authTag
 * @returns {string} - Decrypted text
 */
const decrypt = (encryptedData) => {
  try {
    const { encrypted, iv, authTag } = encryptedData;
    const key = Buffer.from(ENCRYPTION_KEY.slice(0, 32), 'utf8');
    const decipher = crypto.createDecipheriv(ALGORITHM, key, Buffer.from(iv, 'hex'));
    decipher.setAAD(Buffer.from('EHR-System', 'utf8'));
    decipher.setAuthTag(Buffer.from(authTag, 'hex'));
    
    let decrypted = decipher.update(encrypted, 'hex', 'utf8');
    decrypted += decipher.final('utf8');
    
    return decrypted;
  } catch (error) {
    throw new Error('Decryption failed: ' + error.message);
  }
};

/**
 * Generate SHA-256 hash of data
 * @param {string} data - Data to hash
 * @returns {string} - SHA-256 hash
 */
const generateHash = (data) => {
  return crypto.createHash('sha256').update(data).digest('hex');
};

/**
 * Generate secure random token
 * @param {number} length - Token length (default: 32)
 * @returns {string} - Random token
 */
const generateToken = (length = 32) => {
  return crypto.randomBytes(length).toString('hex');
};

/**
 * Verify data integrity using hash
 * @param {string} data - Original data
 * @param {string} hash - Expected hash
 * @returns {boolean} - True if hash matches
 */
const verifyHash = (data, hash) => {
  const computedHash = generateHash(data);
  return computedHash === hash;
};

module.exports = {
  encrypt,
  decrypt,
  generateHash,
  generateToken,
  verifyHash
};
