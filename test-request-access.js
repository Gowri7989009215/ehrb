const mongoose = require('mongoose');
require('dotenv').config();

const User = require('./models/User');
const Consent = require('./models/Consent');

async function testRequestAccess() {
  try {
    console.log('🔍 Testing Request Access Functionality...');
    
    // Connect to database
    await mongoose.connect(process.env.MONGODB_URI || 'mongodb+srv://gowridb:Gowri2005@cluster0.stwwvld.mongodb.net/?appName=Cluster0');
    console.log('✅ Connected to MongoDB');
    
    // Check if we have doctors and patients
    const doctors = await User.find({ role: 'doctor' });
    const patients = await User.find({ role: 'patient' });
    
    console.log(`👨‍⚕️ Found ${doctors.length} doctors`);
    console.log(`👤 Found ${patients.length} patients`);
    
    if (doctors.length === 0 || patients.length === 0) {
      console.log('❌ No doctors or patients found. Please run: npm run seed');
      process.exit(1);
    }
    
    // Check doctor approval status
    const approvedDoctors = doctors.filter(d => d.approved);
    console.log(`✅ Approved doctors: ${approvedDoctors.length}`);
    
    if (approvedDoctors.length === 0) {
      console.log('❌ No approved doctors found. Doctors need admin approval.');
      console.log('Available doctors:');
      doctors.forEach(d => {
        console.log(`  - ${d.name} (${d.email}) - Approved: ${d.approved}`);
      });
    }
    
    // Test environment variables
    console.log('\n🔧 Environment Check:');
    console.log(`MONGODB_URI: ${process.env.MONGODB_URI ? '✅ Set' : '❌ Missing'}`);
    console.log(`JWT_SECRET: ${process.env.JWT_SECRET ? '✅ Set' : '❌ Missing'}`);
    console.log(`ENCRYPTION_KEY: ${process.env.ENCRYPTION_KEY ? '✅ Set' : '❌ Missing'}`);
    
    if (process.env.ENCRYPTION_KEY) {
      console.log(`ENCRYPTION_KEY length: ${process.env.ENCRYPTION_KEY.length} (should be 32)`);
    }
    
    // Test creating a consent request
    if (approvedDoctors.length > 0 && patients.length > 0) {
      console.log('\n🧪 Testing consent creation...');
      
      const testConsent = new Consent({
        patientId: patients[0]._id,
        doctorId: approvedDoctors[0]._id,
        status: 'pending',
        consentType: 'limited-access',
        permissions: { canView: true, canDownload: false },
        allowedCategories: ['general'],
        validUntil: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000),
        blockchainHash: 'test-hash'
      });
      
      await testConsent.validate();
      console.log('✅ Consent validation passed');
    }
    
    console.log('\n✅ Test completed successfully!');
    
  } catch (error) {
    console.error('❌ Test failed:', error.message);
    if (error.stack) {
      console.error('Stack trace:', error.stack);
    }
  } finally {
    await mongoose.connection.close();
    process.exit(0);
  }
}

testRequestAccess();
