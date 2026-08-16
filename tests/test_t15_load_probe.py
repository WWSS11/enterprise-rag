from scripts.t15_load_probe import percentile


def test_percentile_uses_nearest_rank_without_hiding_tail_latency() -> None:
    values = [float(value) for value in range(1, 101)]
    assert percentile(values, 0.50) == 50.0
    assert percentile(values, 0.95) == 95.0
    assert percentile(values, 0.99) == 99.0
