const crypto = require('crypto');

/**
 * Block class representing a single block in the blockchain
 */
class Block {
  constructor(index, timestamp, data, previousHash = '') {
    this.index = index;
    this.timestamp = timestamp;
    this.data = data;
    this.previousHash = previousHash;
    this.nonce = 0;
    this.hash = this.calculateHash();
  }

  /**
   * Calculate SHA-256 hash for the block
   */
  calculateHash() {
    return crypto
      .createHash('sha256')
      .update(this.index + this.previousHash + this.timestamp + JSON.stringify(this.data) + this.nonce)
      .digest('hex');
  }

  /**
   * Simple proof of work (mining simulation)
   */
  mineBlock(difficulty) {
    const target = Array(difficulty + 1).join('0');
    while (this.hash.substring(0, difficulty) !== target) {
      this.nonce++;
      this.hash = this.calculateHash();
    }
    console.log(`Block mined: ${this.hash}`);
  }
}

/**
 * Blockchain class for managing the chain of blocks
 */
class Blockchain {
  constructor() {
    this.chain = [this.createGenesisBlock()];
    this.difficulty = 2;
    this.pendingTransactions = [];
  }

  /**
   * Create the first block (Genesis Block)
   */
  createGenesisBlock() {
    return new Block(0, Date.now(), 'Genesis Block', '0');
  }

  /**
   * Get the latest block in the chain
   */
  getLatestBlock() {
    return this.chain[this.chain.length - 1];
  }

  /**
   * Add a new block to the chain
   */
  addBlock(data) {
    const previousBlock = this.getLatestBlock();
    const newBlock = new Block(
      previousBlock.index + 1,
      Date.now(),
      data,
      previousBlock.hash
    );
    
    newBlock.mineBlock(this.difficulty);
    this.chain.push(newBlock);
    return newBlock;
  }

  /**
   * Record patient consent on blockchain
   */
  recordConsent(patientId, doctorId, action, validUntil = null) {
    const consentData = {
      type: 'CONSENT',
      patientId,
      doctorId,
      action, // 'GRANTED' or 'REVOKED'
      validUntil,
      timestamp: new Date().toISOString()
    };
    
    return this.addBlock(consentData);
  }

  /**
   * Record medical record upload on blockchain
   */
  recordUpload(recordId, patientId, uploaderId, fileHash) {
    const uploadData = {
      type: 'UPLOAD',
      recordId,
      patientId,
      uploaderId,
      fileHash,
      timestamp: new Date().toISOString()
    };
    
    return this.addBlock(uploadData);
  }

  /**
   * Record data access on blockchain
   */
  recordAccess(actorId, targetId, action, recordId = null) {
    const accessData = {
      type: 'ACCESS',
      actorId,
      targetId,
      action, // 'VIEW', 'DOWNLOAD', 'UPDATE'
      recordId,
      timestamp: new Date().toISOString()
    };
    
    return this.addBlock(accessData);
  }

  /**
   * Record user verification on blockchain
   */
  recordVerification(userId, verifierId, action) {
    const verificationData = {
      type: 'VERIFICATION',
      userId,
      verifierId,
      action, // 'APPROVED' or 'REJECTED'
      timestamp: new Date().toISOString()
    };
    
    return this.addBlock(verificationData);
  }

  /**
   * Get audit trail for a specific user
   */
  getAuditTrail(userId) {
    const auditBlocks = [];
    
    for (let block of this.chain) {
      if (block.data && typeof block.data === 'object') {
        const data = block.data;
        if (data.patientId === userId || 
            data.doctorId === userId || 
            data.actorId === userId || 
            data.targetId === userId ||
            data.uploaderId === userId ||
            data.userId === userId) {
          auditBlocks.push({
            blockIndex: block.index,
            timestamp: block.timestamp,
            hash: block.hash,
            data: block.data
          });
        }
      }
    }
    
    return auditBlocks.sort((a, b) => b.timestamp - a.timestamp);
  }

  /**
   * Get all blocks of a specific type
   */
  getBlocksByType(type) {
    return this.chain
      .filter(block => block.data && block.data.type === type)
      .map(block => ({
        blockIndex: block.index,
        timestamp: block.timestamp,
        hash: block.hash,
        data: block.data
      }));
  }

  /**
   * Validate the entire blockchain
   */
  isChainValid() {
    for (let i = 1; i < this.chain.length; i++) {
      const currentBlock = this.chain[i];
      const previousBlock = this.chain[i - 1];

      if (currentBlock.hash !== currentBlock.calculateHash()) {
        return false;
      }

      if (currentBlock.previousHash !== previousBlock.hash) {
        return false;
      }
    }
    return true;
  }

  /**
   * Get blockchain statistics
   */
  getStats() {
    const stats = {
      totalBlocks: this.chain.length,
      isValid: this.isChainValid(),
      types: {}
    };

    this.chain.forEach(block => {
      if (block.data && block.data.type) {
        stats.types[block.data.type] = (stats.types[block.data.type] || 0) + 1;
      }
    });

    return stats;
  }
}

// Create singleton instance
const blockchainInstance = new Blockchain();

module.exports = blockchainInstance;
