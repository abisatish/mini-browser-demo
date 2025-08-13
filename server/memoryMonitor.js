import { exec } from 'child_process';
import { promisify } from 'util';
import os from 'os';

const execAsync = promisify(exec);

class MemoryMonitor {
  constructor() {
    this.metrics = {
      system: {},
      nodeProcess: {},
      chromiumProcesses: [],
      timestamp: null
    };
    this.intervalId = null;
  }

  formatBytes(bytes) {
    return (bytes / 1024 / 1024).toFixed(2) + ' MB';
  }

  async getSystemMemory() {
    const totalMem = os.totalmem();
    const freeMem = os.freemem();
    const usedMem = totalMem - freeMem;
    
    return {
      total: this.formatBytes(totalMem),
      free: this.formatBytes(freeMem),
      used: this.formatBytes(usedMem),
      usedPercent: ((usedMem / totalMem) * 100).toFixed(2) + '%'
    };
  }

  getNodeMemory() {
    const memUsage = process.memoryUsage();
    return {
      rss: this.formatBytes(memUsage.rss),
      heapTotal: this.formatBytes(memUsage.heapTotal),
      heapUsed: this.formatBytes(memUsage.heapUsed),
      external: this.formatBytes(memUsage.external),
      arrayBuffers: this.formatBytes(memUsage.arrayBuffers),
      heapPercent: ((memUsage.heapUsed / memUsage.heapTotal) * 100).toFixed(2) + '%'
    };
  }

  async getChromiumProcesses() {
    try {
      const platform = os.platform();
      let command;
      
      if (platform === 'darwin') {
        command = "ps aux | grep -E '(chrome|chromium)' | grep -v grep | awk '{print $2,$3,$4,$6,$11}'";
      } else if (platform === 'linux') {
        // Railway runs on Linux containers
        command = "ps aux | grep -E '(chrome|chromium|playwright)' | grep -v grep | awk '{print $2,$3,$4,$6,$11}'";
      } else {
        return [];
      }

      const { stdout } = await execAsync(command);
      const lines = stdout.trim().split('\n').filter(line => line);
      
      const processes = lines.map(line => {
        const parts = line.split(/\s+/);
        if (parts.length >= 5) {
          const [pid, cpu, mem, rss, ...cmdParts] = parts;
          const cmd = cmdParts.join(' ');
          
          let type = 'unknown';
          if (cmd.includes('--type=renderer')) type = 'renderer';
          else if (cmd.includes('--type=gpu-process')) type = 'gpu';
          else if (cmd.includes('--type=utility')) type = 'utility';
          else if (cmd.includes('--type=zygote')) type = 'zygote';
          else if (cmd.includes('--type=broker')) type = 'broker';
          else if (!cmd.includes('--type=')) type = 'main';
          
          return {
            pid: parseInt(pid),
            cpu: parseFloat(cpu),
            memPercent: parseFloat(mem),
            rss: this.formatBytes(parseInt(rss) * 1024),
            type,
            command: cmd.substring(0, 100)
          };
        }
        return null;
      }).filter(p => p !== null);

      const summary = {
        totalProcesses: processes.length,
        byType: {},
        totalMemory: 0,
        totalCpu: 0
      };

      processes.forEach(p => {
        summary.byType[p.type] = (summary.byType[p.type] || 0) + 1;
        summary.totalMemory += parseFloat(p.rss);
        summary.totalCpu += p.cpu;
      });

      summary.totalMemory = this.formatBytes(summary.totalMemory * 1024 * 1024);
      summary.totalCpu = summary.totalCpu.toFixed(2) + '%';

      return {
        processes: processes.slice(0, 10),
        summary
      };
    } catch (error) {
      console.error('Error getting Chromium processes:', error);
      return { processes: [], summary: {} };
    }
  }

  async collectMetrics() {
    this.metrics.timestamp = new Date().toISOString();
    this.metrics.system = await this.getSystemMemory();
    this.metrics.nodeProcess = this.getNodeMemory();
    this.metrics.chromiumProcesses = await this.getChromiumProcesses();
    
    return this.metrics;
  }

  async logMemoryUsage() {
    const metrics = await this.collectMetrics();
    
    console.log('\n========================================');
    console.log(`📊 MEMORY REPORT - ${new Date().toLocaleTimeString()}`);
    console.log('========================================');
    
    // Show Railway environment info if available
    if (process.env.RAILWAY_ENVIRONMENT) {
      console.log(`🚂 RAILWAY ENV: ${process.env.RAILWAY_ENVIRONMENT}`);
      console.log(`📦 Service: ${process.env.RAILWAY_SERVICE_NAME || 'N/A'}`);
    }
    
    console.log('\n🖥️  SYSTEM MEMORY:');
    console.log(`   Total: ${metrics.system.total}`);
    console.log(`   Used:  ${metrics.system.used} (${metrics.system.usedPercent})`);
    console.log(`   Free:  ${metrics.system.free}`);
    
    console.log('\n🟢 NODE.JS PROCESS:');
    console.log(`   RSS (Total Process): ${metrics.nodeProcess.rss}`);
    console.log(`   Heap Total: ${metrics.nodeProcess.heapTotal}`);
    console.log(`   Heap Used:  ${metrics.nodeProcess.heapUsed} (${metrics.nodeProcess.heapPercent})`);
    console.log(`   External:   ${metrics.nodeProcess.external}`);
    console.log(`   Buffers:    ${metrics.nodeProcess.arrayBuffers}`);
    
    if (metrics.chromiumProcesses.summary && metrics.chromiumProcesses.summary.totalProcesses > 0) {
      console.log('\n🌐 CHROMIUM PROCESSES:');
      console.log(`   Total Processes: ${metrics.chromiumProcesses.summary.totalProcesses}`);
      console.log(`   Total Memory:    ${metrics.chromiumProcesses.summary.totalMemory}`);
      console.log(`   Total CPU:       ${metrics.chromiumProcesses.summary.totalCpu}`);
      console.log('   Process Types:', metrics.chromiumProcesses.summary.byType);
      
      if (metrics.chromiumProcesses.processes.length > 0) {
        console.log('\n   Top Processes:');
        metrics.chromiumProcesses.processes.slice(0, 5).forEach(p => {
          console.log(`     PID ${p.pid} [${p.type}]: ${p.rss} | CPU: ${p.cpu}%`);
        });
      }
    }
    
    console.log('========================================\n');
  }

  startMonitoring(intervalMs = 30000) {
    this.logMemoryUsage();
    this.intervalId = setInterval(() => {
      this.logMemoryUsage();
    }, intervalMs);
    
    console.log(`✅ Memory monitoring started (interval: ${intervalMs/1000}s)`);
  }

  stopMonitoring() {
    if (this.intervalId) {
      clearInterval(this.intervalId);
      this.intervalId = null;
      console.log('⏹️  Memory monitoring stopped');
    }
  }

  async getMetrics() {
    return await this.collectMetrics();
  }
}

export default MemoryMonitor;