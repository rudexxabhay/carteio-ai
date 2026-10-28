'use strict';

// Preserve completed suite evidence even if a slow mounted-checkout run times
// out before Jest writes its final aggregate report. Uses Jest's JSON shape.
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');

module.exports = class Phase00Results {
  onTestResult(_test, result) {
    const directory = process.env.PHASE00_REPORT_DIR;
    if (!directory) throw new Error('PHASE00_REPORT_DIR is required for the Phase 00 reporter');
    fs.mkdirSync(directory, { recursive: true });
    const id = crypto.createHash('sha256').update(result.testFilePath).digest('hex').slice(0, 16);
    const report = {
      numPassedTests: result.numPassingTests,
      numFailedTests: result.numFailingTests,
      numPendingTests: result.numPendingTests,
      testResults: [{
        name: result.testFilePath,
        status: result.numFailingTests || result.testExecError ? 'failed' : 'passed',
        assertionResults: result.testResults,
        message: result.failureMessage ?? '',
      }],
    };
    const destination = path.join(directory, `${path.basename(result.testFilePath)}-${id}.json`);
    fs.writeFileSync(`${destination}.tmp`, JSON.stringify(report, null, 2));
    fs.renameSync(`${destination}.tmp`, destination);
  }
};
