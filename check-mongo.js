(async ()=>{
  try{
    const uri = process.env.MONGODB_URI;
    if(!uri){
      console.log('MONGODB_URI is not set in this environment');
      process.exit(0);
    }
    const { MongoClient } = require('mongodb');
    const client = new MongoClient(uri, { serverSelectionTimeoutMS: 5000 });
    await client.connect();
    console.log('MongoDB: connection successful');
    await client.db().admin().ping();
    console.log('MongoDB ping OK');
    await client.close();
  } catch (e) {
    console.error('MongoDB connection failed:', e && e.message);
    process.exit(1);
  }
})();
