const mongoose = require('mongoose');
const bcrypt = require('bcryptjs');
require('dotenv').config();

const User = require('../models/User');
const Record = require('../models/Record');
const Consent = require('../models/Consent');
const AuditLog = require('../models/AuditLog');
const blockchain = require('../blockchain');
const { encrypt, generateHash } = require('../utils/encryption');

// Connect to MongoDB
const connectDB = async () => {
  try {
    await mongoose.connect(process.env.MONGODB_URI, {
      useNewUrlParser: true,
      useUnifiedTopology: true,
    });
    console.log('MongoDB Connected for seeding');
  } catch (error) {
    console.error('Database connection failed:', error);
    process.exit(1);
  }
};

// Sample users data
const sampleUsers = [
  // Admin
  {
    name: 'System Administrator',
    email: 'admin@ehrsystem.com',
    password: 'admin123',
    role: 'admin',
    approved: true,
    profileData: {
      phone: '+1-555-0001'
    }
  },
  // Patients
  {
    name: 'John Doe',
    email: 'john.doe@email.com',
    password: 'patient123',
    role: 'patient',
    approved: true,
    profileData: {
      dateOfBirth: new Date('1985-06-15'),
      phone: '+1-555-0101',
      address: '123 Main St, Anytown, USA',
      emergencyContact: {
        name: 'Jane Doe',
        phone: '+1-555-0102',
        relationship: 'Spouse'
      }
    }
  },
  {
    name: 'Alice Johnson',
    email: 'alice.johnson@email.com',
    password: 'patient123',
    role: 'patient',
    approved: true,
    profileData: {
      dateOfBirth: new Date('1990-03-22'),
      phone: '+1-555-0201',
      address: '456 Oak Ave, Somewhere, USA',
      emergencyContact: {
        name: 'Bob Johnson',
        phone: '+1-555-0202',
        relationship: 'Father'
      }
    }
  },
  // Doctors
  {
    name: 'Dr. Sarah Wilson',
    email: 'dr.wilson@hospital.com',
    password: 'doctor123',
    role: 'doctor',
    approved: true,
    profileData: {
      specialization: 'Cardiology',
      licenseNumber: 'MD-12345',
      phone: '+1-555-0301',
      address: '789 Medical Center Dr, Healthcare City, USA'
    }
  },
  {
    name: 'Dr. Michael Chen',
    email: 'dr.chen@hospital.com',
    password: 'doctor123',
    role: 'doctor',
    approved: true,
    profileData: {
      specialization: 'Neurology',
      licenseNumber: 'MD-12346',
      phone: '+1-555-0302',
      address: '789 Medical Center Dr, Healthcare City, USA'
    }
  },
  {
    name: 'Dr. Emily Rodriguez',
    email: 'dr.rodriguez@clinic.com',
    password: 'doctor123',
    role: 'doctor',
    approved: false, // Pending approval
    profileData: {
      specialization: 'Pediatrics',
      licenseNumber: 'MD-12347',
      phone: '+1-555-0303',
      address: '321 Clinic St, Medtown, USA'
    }
  },
  // Hospitals
  {
    name: 'General Hospital',
    email: 'admin@generalhospital.com',
    password: 'hospital123',
    role: 'hospital',
    approved: true,
    profileData: {
      licenseNumber: 'HOSP-001',
      phone: '+1-555-0401',
      address: '789 Medical Center Dr, Healthcare City, USA'
    }
  },
  {
    name: 'City Medical Center',
    email: 'admin@citymedical.com',
    password: 'hospital123',
    role: 'hospital',
    approved: false, // Pending approval
    profileData: {
      licenseNumber: 'HOSP-002',
      phone: '+1-555-0402',
      address: '555 Hospital Blvd, Metro City, USA'
    }
  }
];

// Sample medical records data
const sampleRecordsData = [
  {
    title: 'Annual Physical Examination',
    description: 'Routine annual checkup with vital signs and basic tests',
    content: 'Patient appears healthy. Blood pressure: 120/80, Heart rate: 72 bpm, Temperature: 98.6°F. No significant findings.',
    fileType: 'text',
    category: 'general',
    tags: ['annual', 'checkup', 'vitals']
  },
  {
    title: 'Blood Test Results',
    description: 'Complete blood count and metabolic panel',
    content: 'CBC: WBC 7.2, RBC 4.5, Hemoglobin 14.2, Hematocrit 42%. Metabolic Panel: Glucose 95, Creatinine 1.0, All values within normal range.',
    fileType: 'lab-report',
    category: 'lab-results',
    tags: ['blood', 'lab', 'cbc', 'metabolic']
  },
  {
    title: 'Chest X-Ray Report',
    description: 'Chest X-ray for routine screening',
    content: 'Chest X-ray shows clear lungs with no signs of infection, masses, or abnormalities. Heart size normal.',
    fileType: 'image',
    category: 'radiology',
    tags: ['xray', 'chest', 'radiology', 'screening']
  }
];

// Seed function
const seedDatabase = async () => {
  try {
    console.log('🌱 Starting database seeding...');

    // Clear existing data
    await User.deleteMany({});
    await Record.deleteMany({});
    await Consent.deleteMany({});
    await AuditLog.deleteMany({});
    console.log('✅ Cleared existing data');

    // Create users
    const createdUsers = [];
    for (const userData of sampleUsers) {
      const user = new User(userData);
      await user.save();
      createdUsers.push(user);
      console.log(`✅ Created ${user.role}: ${user.name}`);
    }

    // Get specific users for relationships
    const patients = createdUsers.filter(user => user.role === 'patient');
    const doctors = createdUsers.filter(user => user.role === 'doctor' && user.approved);
    const hospitals = createdUsers.filter(user => user.role === 'hospital' && user.approved);

    // Associate doctors with hospital
    if (hospitals.length > 0 && doctors.length > 0) {
      const hospital = hospitals[0];
      for (let i = 0; i < Math.min(2, doctors.length); i++) {
        doctors[i].profileData.hospitalId = hospital._id;
        await doctors[i].save();
        console.log(`✅ Associated Dr. ${doctors[i].name} with ${hospital.name}`);
      }
    }

    // Create sample medical records for patients
    for (const patient of patients) {
      for (let i = 0; i < sampleRecordsData.length; i++) {
        const recordData = sampleRecordsData[i];
        
        // Encrypt the content
        const encryptedData = encrypt(recordData.content);
        const originalHash = generateHash(recordData.content);

        const record = new Record({
          patientId: patient._id,
          uploaderId: patient._id,
          title: recordData.title,
          description: recordData.description,
          fileType: recordData.fileType,
          category: recordData.category,
          encryptedData,
          originalHash,
          blockchainHash: '', // Will be set after blockchain record
          metadata: {
            mimeType: 'text/plain',
            fileSize: Buffer.byteLength(recordData.content, 'utf8'),
            recordDate: new Date(Date.now() - (i * 24 * 60 * 60 * 1000)) // Spread over days
          },
          tags: recordData.tags
        });

        // Record upload on blockchain
        const blockchainRecord = blockchain.recordUpload(
          record._id.toString(),
          patient._id.toString(),
          patient._id.toString(),
          originalHash
        );

        record.blockchainHash = blockchainRecord.hash;
        await record.save();

        console.log(`✅ Created record: ${record.title} for ${patient.name}`);
      }
    }

    // Create sample consent relationships
    if (patients.length > 0 && doctors.length > 0) {
      const patient = patients[0]; // John Doe
      const doctor = doctors[0];   // Dr. Sarah Wilson

      const consent = new Consent({
        patientId: patient._id,
        doctorId: doctor._id,
        status: 'granted',
        consentType: 'limited-access',
        permissions: {
          canView: true,
          canDownload: false,
          canUpdate: true,
          canShare: false
        },
        allowedCategories: ['general', 'cardiology', 'lab-results'],
        validUntil: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000), // 30 days from now
        blockchainHash: '' // Will be set after blockchain record
      });

      // Record consent on blockchain
      const blockchainRecord = blockchain.recordConsent(
        patient._id.toString(),
        doctor._id.toString(),
        'GRANTED',
        consent.validUntil
      );

      consent.blockchainHash = blockchainRecord.hash;
      await consent.save();

      console.log(`✅ Created consent: ${patient.name} -> Dr. ${doctor.name}`);

      // Create a pending consent request
      if (doctors.length > 1) {
        const pendingConsent = new Consent({
          patientId: patient._id,
          doctorId: doctors[1]._id,
          status: 'pending',
          consentType: 'limited-access',
          requestMessage: 'Requesting access for neurological consultation',
          permissions: {
            canView: true,
            canDownload: false,
            canUpdate: false,
            canShare: false
          },
          allowedCategories: ['neurology', 'general'],
          validUntil: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000),
          blockchainHash: ''
        });

        const pendingBlockchainRecord = blockchain.recordConsent(
          patient._id.toString(),
          doctors[1]._id.toString(),
          'REQUESTED',
          pendingConsent.validUntil
        );

        pendingConsent.blockchainHash = pendingBlockchainRecord.hash;
        await pendingConsent.save();

        console.log(`✅ Created pending consent: ${patient.name} <- Dr. ${doctors[1].name}`);
      }
    }

    // Create some audit logs
    const admin = createdUsers.find(user => user.role === 'admin');
    if (admin) {
      await AuditLog.logActivity(
        admin._id,
        'SYSTEM_MAINTENANCE',
        'Database seeded with sample data',
        {
          resourceType: 'system',
          metadata: {
            seedDate: new Date().toISOString(),
            usersCreated: createdUsers.length,
            recordsCreated: patients.length * sampleRecordsData.length
          },
          severity: 'low',
          status: 'success'
        }
      );
    }

    console.log('\n🎉 Database seeding completed successfully!');
    console.log('\n📊 Summary:');
    console.log(`👥 Users created: ${createdUsers.length}`);
    console.log(`📄 Records created: ${patients.length * sampleRecordsData.length}`);
    console.log(`🤝 Consents created: ${patients.length > 0 && doctors.length > 0 ? 2 : 0}`);
    console.log(`⛓️  Blockchain blocks: ${blockchain.chain.length}`);
    
    console.log('\n🔑 Sample Login Credentials:');
    console.log('Admin: admin@ehrsystem.com / admin123');
    console.log('Patient: john.doe@email.com / patient123');
    console.log('Doctor: dr.wilson@hospital.com / doctor123');
    console.log('Hospital: admin@generalhospital.com / hospital123');

  } catch (error) {
    console.error('❌ Seeding failed:', error);
    process.exit(1);
  }
};

// Run seeding
const runSeed = async () => {
  await connectDB();
  await seedDatabase();
  
  console.log('\n✅ Seeding process completed. Closing connection...');
  await mongoose.connection.close();
  process.exit(0);
};

// Execute if run directly
if (require.main === module) {
  runSeed();
}

module.exports = { seedDatabase, sampleUsers };
