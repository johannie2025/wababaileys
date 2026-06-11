// src/routes/queueRoutes.js
const router = require('express').Router();
const { sendQueue, pushSend } = require('../core/queue');

router.get('/stats', async (_req, res) => {
  try {
    const [waiting, active, completed, failed] = await Promise.all([
      sendQueue.getWaitingCount(), sendQueue.getActiveCount(),
      sendQueue.getCompletedCount(), sendQueue.getFailedCount()
    ]);
    res.json({ ok: true, waiting, active, completed, failed });
  } catch (err) { res.status(500).json({ ok: false, error: err.message }); }
});

router.delete('/failed', async (_req, res) => {
  try {
    await sendQueue.clean(0, 0, 'failed');
    res.json({ ok: true, message: 'Jobs échoués supprimés' });
  } catch (err) { res.status(500).json({ ok: false, error: err.message }); }
});

router.post('/retry-failed', async (_req, res) => {
  try {
    const failed = await sendQueue.getFailed();
    for (const job of failed) await job.retry();
    res.json({ ok: true, retried: failed.length });
  } catch (err) { res.status(500).json({ ok: false, error: err.message }); }
});

module.exports = router;
