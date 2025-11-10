/* eslint-disable tsdoc/syntax */

// A vendored copy of node-tree-kill (to avoid having to maintain an extra npm
// dep that will introduce merge conflicts relative to upstream Electron Fiddle)
// https://github.com/pkrumins/node-tree-kill
//
// MIT License
//
// Copyright (c) 2018 Peter Krumins
//
// Permission is hereby granted, free of charge, to any person obtaining a copy
// of this software and associated documentation files (the "Software"), to deal
// in the Software without restriction, including without limitation the rights
// to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
// copies of the Software, and to permit persons to whom the Software is
// furnished to do so, subject to the following conditions:
//
// The above copyright notice and this permission notice shall be included in all
// copies or substantial portions of the Software.
//
// THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
// IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
// FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
// AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
// LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
// OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
// SOFTWARE.

import { exec, spawn } from 'node:child_process';

/**
 * Kills process identified by `pid` and all its children
 *
 * @param {number} pid
 * @param {NodeJS.Signals | number} [signal] 'SIGTERM' by default
 * @param {(error?: Error) => void} [callback]
 */
export function treeKill(pid, signal, callback) {
  if (typeof signal === 'function' && callback === undefined) {
    callback = signal;
    signal = undefined;
  }

  pid = parseInt(pid);
  if (Number.isNaN(pid)) {
    if (callback) {
      return callback(new Error('pid must be a number'));
    } else {
      throw new Error('pid must be a number');
    }
  }

  const tree = {};
  const pidsToProcess = {};
  tree[pid] = [];
  pidsToProcess[pid] = 1;

  switch (process.platform) {
    case 'win32':
      exec('taskkill /pid ' + pid + ' /T /F', callback);
      break;
    case 'darwin':
      buildProcessTree(
        pid,
        tree,
        pidsToProcess,
        function (parentPid) {
          return spawn('pgrep', ['-P', parentPid]);
        },
        function () {
          killAll(tree, signal, callback);
        },
      );
      break;
    // case 'sunos':
    //     buildProcessTreeSunOS(pid, tree, pidsToProcess, function () {
    //         killAll(tree, signal, callback);
    //     });
    //     break;
    default: // Linux
      buildProcessTree(
        pid,
        tree,
        pidsToProcess,
        function (parentPid) {
          return spawn('ps', [
            '-o',
            'pid',
            '--no-headers',
            '--ppid',
            parentPid,
          ]);
        },
        function () {
          killAll(tree, signal, callback);
        },
      );
      break;
  }
}

function killAll(tree, signal, callback) {
  const killed = {};
  try {
    Object.keys(tree).forEach(function (pid) {
      tree[pid].forEach(function (pidpid) {
        if (!killed[pidpid]) {
          killPid(pidpid, signal);
          killed[pidpid] = 1;
        }
      });
      if (!killed[pid]) {
        killPid(pid, signal);
        killed[pid] = 1;
      }
    });
  } catch (err) {
    if (callback) {
      return callback(err);
    } else {
      throw err;
    }
  }
  if (callback) {
    return callback();
  }
}

function killPid(pid, signal) {
  try {
    process.kill(parseInt(pid, 10), signal);
  } catch (err) {
    if (err.code !== 'ESRCH') throw err;
  }
}

function buildProcessTree(
  parentPid,
  tree,
  pidsToProcess,
  spawnChildProcessesList,
  cb,
) {
  const ps = spawnChildProcessesList(parentPid);
  let allData = '';
  ps.stdout.on('data', function (data) {
    var data = data.toString('ascii');
    allData += data;
  });

  const onClose = function (code) {
    delete pidsToProcess[parentPid];

    if (code != 0) {
      // no more parent processes
      if (Object.keys(pidsToProcess).length == 0) {
        cb();
      }
      return;
    }

    allData.match(/\d+/g).forEach(function (pid) {
      pid = parseInt(pid, 10);
      tree[parentPid].push(pid);
      tree[pid] = [];
      pidsToProcess[pid] = 1;
      buildProcessTree(pid, tree, pidsToProcess, spawnChildProcessesList, cb);
    });
  };

  ps.on('close', onClose);
}
