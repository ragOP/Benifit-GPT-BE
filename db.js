const mongoose = require('mongoose');

exports.connectToDatabase = () => {
    if (!process.env.MONGODB_URI) {
        console.error('MongoDB URI is not defined in environment variables');
        return;
    }
    mongoose.connect(process.env.MONGODB_URI)
    .then(() => console.log('MongoDB connected...'))
    .catch(err => console.error('MongoDB connection error:', err));
};

