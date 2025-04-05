const mongoose = require('mongoose');

exports.connectToDatabase = () => {
    mongoose.connect('mongodb+srv://cheif:oPJiwTMYr9Bx1RX1@benifit-gpt.jbuljrl.mongodb.net/?retryWrites=true&w=majority&appName=Benifit-GPT')
    .then(() => console.log('MongoDB connected...'))
    .catch(err => console.error('MongoDB connection error:', err));
};

