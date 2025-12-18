import {Weight} from '../best'

// servers/home/tiny_test/tiny.js
async function main(ns) {
  ns.disableLog("ALL");
  let all_servers = GetAllServers(ns).filter(s => Weight(ns, s) > 0).sort((a, b) => Weight(ns, b) - Weight(ns, a));

  const [target = all_servers[0], pct = 0.05] = ns.args;
  let server = target
  if (!ns.fileExists("tinyhack.js", "home") || target == "reset") CreateScript(ns, "hack");
  if (!ns.fileExists("tinygrow.js", "home") || target == "reset") CreateScript(ns, "grow");
  if (!ns.fileExists("tinyweaken.js", "home") || target == "reset") CreateScript(ns, "weaken");
  for (const server2 of GetAllServers(ns)) {
    if (server2 == "home") continue;
    if (!ns.fileExists("tinyhack.js", server2) || target == "reset") ns.scp("tinyhack.js", server2);
    if (!ns.fileExists("tinygrow.js", server2) || target == "reset") ns.scp("tinygrow.js", server2);
    if (!ns.fileExists("tinyweaken.js", server2) || target == "reset") ns.scp("tinyweaken.js", server2);
  }
  if (target == "reset") return;
  while (true) {
    if (!IsPrepped(ns, target)) await BatchPrep(ns, target);
    let so = ns.getServer(target);
    const hackPctThread = ns.hackAnalyze(target);
    const hThreads = Math.floor(pct / hackPctThread);
    const effectivePct = hackPctThread * hThreads;
    const batchMoney = so.moneyAvailable * effectivePct;
    const hackRam = ns.getScriptRam("tinyhack.js");

    so.moneyAvailable -= batchMoney;
    so.hackDifficulty += hThreads * 0.002;
    const gThreads = Math.ceil(ns.growthAnalyze(server, 1 / (1 - effectivePct))*1.1);
    const growRam = ns.getScriptRam("tinygrow.js");

    const wThreads = Math.ceil((hThreads * 0.002 + gThreads * 0.004) / 0.05);
    const weakenRam = ns.getScriptRam("tinyweaken.js");
    const batchRam = hackRam + growRam + weakenRam;

    var maxtime = Math.max(ns.getHackTime(target), ns.getGrowTime(target), ns.getWeakenTime(target));
    var hWait = maxtime - ns.getHackTime(target);
    var gWait = maxtime + 4 - ns.getGrowTime(target);
    var wWait = maxtime + 8 - ns.getWeakenTime(target);
    if (hWait<0) {hWait=0}
    if (wWait<0) {wWait=0}
    if (gWait<0) {gWait=0}

    ns.print("INFO: Thread balance: H: " + hThreads + " G: " + gThreads + " W: " + wThreads+`BATCH_RAM=${batchRam}GB, amount available=${AvailableRam(ns)}GB, biggest ram ${BiggestRam(ns).name}, weaken delay=${wWait}ms, weaken threads=${wThreads}`);
    so = ns.getServer(target);
    const pids = [];
    let batchCount = 0;
    while (BiggestRam(ns).available > growRam && AvailableRam(ns) > batchRam && batchCount < 120000) {
      batchCount++;
      if (batchCount % 200 == 0) await ns.sleep(0);
      ns.print("Starting batch #" + batchCount);
      const tempPids = [];
      try {
        tempPids.push(...RunScript(ns, "tinyhack.js", target, hWait, hThreads));
        tempPids.push(...RunScript(ns, "tinygrow.js", target, gWait, gThreads));
        tempPids.push(...RunScript(ns, "tinyweaken.js", target, wWait, wThreads));
      } catch (error_code) {
        ns.tprint('Error code: ' + error_code);
        ns.print("WARN: Could not spawn batch #" + batchCount);
        if (tempPids.length > 0) {
          ns.print("    WARN: Deleting partial batch #" + batchCount + ", total " + tempPids.length + " job(s)");
          for (let _pid of tempPids) {
            ns.kill(_pid);
          }
        }
        batchCount--;
        break;
      }
      await ns.sleep(4)
      pids.push(...tempPids);
    }
    ns.print("INFO: Waiting on " + batchCount + " batches to end");
    await WaitPids(ns, pids);
    await ns.sleep(0);
  }
}
function RamSnapshot(ns) {
  return GetAllServers(ns).filter((p) => ns.getServer(p).hasAdminRights && ns.getServer(p).maxRam > 0).map((s) => {
    return { name: s, available: ns.getServer(s).maxRam - ns.getServer(s).ramUsed };
  }).sort((a, b) => ns.getServer(b.name).maxRam - ns.getServer(b.name).ramUsed - (ns.getServer(a.name).maxRam - ns.getServer(a.name).ramUsed));
}
function AvailableRam(ns) {
  return RamSnapshot(ns).reduce((sum, s) => sum + s.available, 0);
}
function BiggestRam(ns) {
  return RamSnapshot(ns)[0];
}
function CreateScript(ns, command) {
  ns.write("tiny" + command + ".js", "export async function main(ns) { await ns." + command + "(ns.args[0], { additionalMsec: ns.args[1] }) }", "w");
}
function GetAllServers(ns) {
  const z = (t) => [t, ...ns.scan(t).slice(t != "home").flatMap(z)];
  return z("home");
}
function IsPrepped(ns, target) {
  return ns.getServer(target).hackDifficulty === ns.getServer(target).minDifficulty && ns.getServer(target).moneyAvailable === ns.getServer(target).moneyMax;
}
/** @param {NS} ns */
async function BatchPrep(ns, server2) {
  ns.print("WARN: Prepping " + server2);
  ns.print("WARN: Security is " + ns.getServer(server2).hackDifficulty + " min: " + ns.getServer(server2).minDifficulty);
  ns.print("WARN: Money is " + ns.getServer(server2).moneyAvailable + " max: " + ns.getServer(server2).moneyMax);
  while (!IsPrepped(ns, server2)) {
    const so = ns.getServer(server2);
    let sec = so.hackDifficulty - so.minDifficulty;
    let w1threads = Math.ceil(sec / 0.05)+1;
    let gthreads2 = Math.ceil(ns.growthAnalyze(server2, ns.getServerMaxMoney(server2) / ns.getServerMoneyAvailable(server2)))+1;
    let w2threads = Math.ceil(gthreads2 * 4e-3 / 0.05)+1;
    if (w1threads < 1) w1threads = 1;
    if (gthreads2 < 1) gthreads2 = 1;
    var w2wait = 0;
    if (w2threads>0) {w2wait = ns.getGrowTime(so.hostname)+50-ns.getWeakenTime(so.hostname);}
    const allPids = [];
    if (w1threads > 0) {
      ns.print("INFO: Security is over minimum, starting " + w1threads + " threads to floor it");
      const pids = RunScript(ns, "tinyweaken.js", server2, 0, w1threads, true);
      allPids.push(...pids);
    }
    if (gthreads2 > 0) {
      ns.print("INFO: Funds are not maxed, starting " + gthreads2 + " threads to grow them");
      const pids = RunScript(ns, "tinygrow.js", server2, 0, gthreads2, true);
      allPids.push(...pids);
    }
    if (w2threads > 0) {
      ns.print("INFO: We launched grow threads, starting " + w2threads + " weaken threads to cancel them it");
      const pids = RunScript(ns, "tinyweaken.js", server2, w2wait, w2threads, true);
      allPids.push(...pids);
    }
    await WaitPids(ns, allPids);
    await ns.sleep(0);
  }
}
async function WaitPids(ns, pids) {
  if (!Array.isArray(pids)) pids = [pids];
  while (pids.some((p) => ns.isRunning(p))) {
    await ns.sleep(5);
  }
}
function RunScript(ns, scriptName, target, delay, threads, allowPartial = false) {
  const ramPerThread = ns.getScriptRam(scriptName);
  let fired = 0;
  const pids = [];
  for (const server2 of RamSnapshot(ns)) {
    let possibleThreads = Math.floor(server2.available / ramPerThread);
    if (possibleThreads < threads && threads != Infinity && !allowPartial) {
      ns.print("WARN: Impossible to launch job without breaking it apart");
      throw "Impossible to launch job without breaking it apart";
    } else if (possibleThreads > threads)
      possibleThreads = threads;
    if (possibleThreads == 0) continue;
    ns.print("INFO: Starting script " + scriptName + " on " + server2.name + " with " + possibleThreads + " threads");
    if (delay<0) delay=0;
    let pid = ns.exec(scriptName, server2.name, possibleThreads, target, delay);
    if (pid == 0)
      ns.print("WARN: Could not start script " + scriptName + " on " + server2.name + " with " + possibleThreads + " threads");
    else {
      fired += possibleThreads;
      pids.push(pid);
    }
    if (fired >= threads) break;
  }
  if (fired == 0) {
    ns.print("FAIL: Not enough memory to launch a single thread of " + scriptName + " (out of memory on all servers!)");
    if (!allowPartial)
      throw "Not enough memory to launch a single thread of " + scriptName + " (out of memory on all servers!)";
  }
  if (fired != threads && threads != Infinity) {
    ns.print("FAIL: There wasn't enough ram to run " + threads + " threads of " + scriptName + " (fired: " + fired + ").");
    if (!allowPartial)
      throw "There wasn't enough ram to run " + threads + " threads of " + scriptName + " (fired: " + fired + ").";
  }
  return pids;
}
export {
  main
};
