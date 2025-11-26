// MongoDB initialization script
db = db.getSiblingDB('ehr_system');

// Create collections with indexes
db.createCollection('users');
db.createCollection('records');
db.createCollection('consents');
db.createCollection('auditlogs');

// Create indexes for better performance
db.users.createIndex({ "email": 1 }, { unique: true });
db.users.createIndex({ "role": 1, "approved": 1 });

db.records.createIndex({ "patientId": 1, "createdAt": -1 });
db.records.createIndex({ "uploaderId": 1, "createdAt": -1 });
db.records.createIndex({ "category": 1, "fileType": 1 });

db.consents.createIndex({ "patientId": 1, "doctorId": 1 }, { unique: true });
db.consents.createIndex({ "doctorId": 1, "status": 1 });
db.consents.createIndex({ "validUntil": 1, "status": 1 });

db.auditlogs.createIndex({ "actorId": 1, "timestamp": -1 });
db.auditlogs.createIndex({ "action": 1, "timestamp": -1 });
db.auditlogs.createIndex({ "severity": 1, "timestamp": -1 });

print('Database initialized successfully!');
