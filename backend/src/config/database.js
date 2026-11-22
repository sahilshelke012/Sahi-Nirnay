import mongoose from 'mongoose';

export function connectDatabase(uri, options = {}) {
  if (!uri) throw new Error('MONGODB_URI must be configured.');
  return mongoose.createConnection(uri, {
    serverSelectionTimeoutMS: 5000,
    bufferCommands: false,
    ...options,
  }).asPromise();
}
