function run_matlab_batch(list)
%RUN_MATLAB_BATCH Runs many test scripts in one MATLAB session.
%   RUN_MATLAB_BATCH(LIST) reads LIST, a text file whose lines each hold a
%   job folder and, after a tab, the name of the script in it (without .m).
%   analysis_scripts.test.mjs writes the folders and the list, and reads back
%   what this function writes into each folder:
%
%     started.txt  written just before the script runs
%     stdout.txt   the script's Command Window text, warnings included,
%                  with their hyperlinks and backspaces removed
%     stderr.txt   the error report, when the script stops with an error
%     status.txt   0, or 1 after an error; written last, and so it marks
%                  the job as finished
%
%   The test harness watches started.txt to stop a script that hangs, and
%   status.txt to stop MATLAB when it hangs between scripts or after the last.
%
%   Each script runs as it would in a MATLAB of its own: from its own folder
%   (the CSV-reading scripts open their files by relative paths), in a fresh
%   function workspace, with the random number generator, the display format,
%   and the warning states MATLAB starts with, and with every figure closed
%   afterward. An error ends only its own script.

lines = splitlines(strtrim(fileread(list)));
home = pwd;
warn0 = warning;
for i = 1:numel(lines)
  parts = strsplit(lines{i}, sprintf('\t'));
  folder = parts{1};
  name = parts{2};
  write_text(fullfile(folder, 'started.txt'), '');
  rng('default');
  format;
  lastwarn('');
  cd(folder);
  [out, err] = capture(fullfile(folder, [name '.m']));
  cd(home);
  close all force;
  warning(warn0);
  format;
  clear(name);
  % A warning's text carries hyperlinks (its stack's "In ..." lines) and backspaces
  % around its brackets, which the Command Window renders and a log does not.
  write_text(fullfile(folder, 'stdout.txt'), regexprep(out, ['<a\s(?:[^>"]|"[^"]*")*>|</a>|' char(8)], ''));
  if isempty(err)
    write_text(fullfile(folder, 'stderr.txt'), '');
    write_status(folder, '0');
  else
    write_text(fullfile(folder, 'stderr.txt'), getReport(err, 'extended', 'hyperlinks', 'off'));
    write_status(folder, '1');
  end
end
end

function [oa__out, oa__err] = capture(oa__file)
% The script runs in this function's workspace, which holds nothing else
% it could read or overwrite, and which is discarded on return. The whole
% try block is captured, and so the text printed before an error is kept.
% A script that ends with clear removes oa__err, which then means no error.
oa__out = evalc('try, run(oa__file); oa__err = []; catch oa__err, end');
if ~exist('oa__err', 'var')
  oa__err = [];
end
end

function write_status(folder, status)
% Written under another name and renamed, so that status.txt never exists
% half written.
write_text(fullfile(folder, 'status.tmp'), status);
movefile(fullfile(folder, 'status.tmp'), fullfile(folder, 'status.txt'));
end

function write_text(file, text)
fid = fopen(file, 'w', 'n', 'UTF-8');
if fid < 0
  error('run_matlab_batch:write', 'Cannot write %s.', file);
end
fprintf(fid, '%s', text);
fclose(fid);
end
