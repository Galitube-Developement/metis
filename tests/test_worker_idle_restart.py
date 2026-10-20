import importlib.util
from pathlib import Path
import unittest

spec = importlib.util.spec_from_file_location("worker_idle_restart", Path(__file__).parents[1] / "scripts/restart-worker-when-idle.py")
helper = importlib.util.module_from_spec(spec)
spec.loader.exec_module(helper)


class WorkerIdleRestartTest(unittest.TestCase):
    def run_scenario(self, states, expected_status):
        clock = [0]
        calls = []
        observations = iter(states)
        last = states[-1]
        def inspect():
            return next(observations, last)
        def pause(seconds):
            clock[0] += seconds
        result = helper.wait_and_restart(inspect, lambda: calls.append("restart"), 42, 6,
                                         now=lambda: clock[0], pause=pause)
        self.assertEqual(result["status"], expected_status)
        return calls

    def test_active_or_queued_jobs_are_never_restarted(self):
        for active, processes in [(1, []), (0, [123])]:
            self.assertEqual(self.run_scenario([{"pid": 42, "active_jobs": active, "job_processes": processes}],
                                              "deferred_timeout"), [])

    def test_stable_idle_state_restarts_exactly_once(self):
        busy = {"pid": 42, "active_jobs": 1, "job_processes": [123]}
        idle = {"pid": 42, "active_jobs": 0, "job_processes": []}
        self.assertEqual(self.run_scenario([busy, idle, idle, busy, idle], "restarted"), ["restart"])

    def test_manual_restart_supersedes_the_queued_activation(self):
        self.assertEqual(self.run_scenario([{"pid": 43, "active_jobs": 0, "job_processes": []}],
                                          "superseded"), [])


if __name__ == "__main__":
    unittest.main()
