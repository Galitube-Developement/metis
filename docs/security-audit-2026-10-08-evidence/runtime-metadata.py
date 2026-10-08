"""Read only model/effort CLI metadata for one job. Never print prompts or secrets."""
import glob, json, re, sys
job_id = sys.argv[1]
found = False
for filename in glob.glob('/proc/[0-9]*/cmdline'):
    try:
        args = open(filename, 'rb').read().decode().split('\0')
    except (OSError, UnicodeError):
        continue
    if not (args and '/codex' in args[0] and 'exec' in args):
        continue
    pid = filename.split('/')[2]
    matches = False
    for _ in range(5):
        try:
            cmd = open('/proc/' + pid + '/cmdline', 'rb').read().decode()
            if job_id in cmd:
                matches = True
                break
            status = open('/proc/' + pid + '/status').read()
            pid = re.search(r'^PPid:\s+(\d+)', status, re.M).group(1)
        except (OSError, UnicodeError, AttributeError):
            break
    if matches:
        found = True
        print(json.dumps({'jobId':job_id, 'model':[args[i+1] for i in range(len(args)-1) if args[i]=='--model'], 'explicitReasoningEffort':[a for a in args if a.startswith('model_reasoning_effort=')]}))
if not found:
    print('ACTIVE_RUNTIME_NOT_FOUND')
    sys.exit(1)
