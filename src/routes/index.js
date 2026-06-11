// src/routes/index.js
const router = require('express').Router();

router.use('/session',   require('./session'));
router.use('/messages',  require('./messages'));
router.use('/media',     require('./media'));
router.use('/groups',    require('./groups'));
router.use('/status',    require('./status'));
router.use('/contacts',  require('./contacts'));
router.use('/crm',       require('./crm'));
router.use('/chatbot',   require('./chatbot'));
router.use('/auth',      require('./auth2fa'));
router.use('/queue',     require('./queueRoutes'));

module.exports = router;
