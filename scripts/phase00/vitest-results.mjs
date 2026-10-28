import { mkdirSync, writeFileSync, renameSync } from 'node:fs';
import { basename, join } from 'node:path';
import { createHash } from 'node:crypto';
import { JsonReporter } from '../../frontend/node_modules/vitest/dist/reporters.js';

// Use the installed reporter's serialization, preserving its assertion names
// and failures while durably recording each completed file on slow filesystems.
export default class Phase00VitestResults extends JsonReporter {
  completed = new Set();
  constructor() { super({}); }
  async onTaskUpdate() {
    for (const file of this.ctx.state.getFiles()) {
      if (!['pass', 'fail'].includes(file.result?.state) || this.completed.has(file.filepath)) continue;
      this.completed.add(file.filepath);
      await this.logTasks([file]);
    }
  }
  async onFinished(files = this.ctx.state.getFiles()) {
    for (const file of files) await this.logTasks([file]);
  }
  async writeReport(serialized) {
    const directory = process.env.PHASE00_REPORT_DIR;
    if (!directory) throw new Error('PHASE00_REPORT_DIR is required for the Phase 00 reporter');
    const report = JSON.parse(serialized);
    const file = report.testResults[0].name;
    const id = createHash('sha256').update(file).digest('hex').slice(0, 16);
    mkdirSync(directory, { recursive: true });
    const destination = join(directory, `${basename(file)}-${id}.json`);
    writeFileSync(`${destination}.tmp`, serialized);
    renameSync(`${destination}.tmp`, destination);
  }
}
