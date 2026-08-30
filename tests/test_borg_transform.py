from scripts.transform_borg import transform


def test_borg_transform_keeps_trace_and_scenario_fields_distinct() -> None:
    rows = [
        {
            "anonymized_collection_id": "abcdef0123456789",
            "priority": "10",
            "requested_cpu": "0.6",
            "requested_memory": "0.4",
            "start_time": "0",
            "end_time": "600000000",
        }
    ]
    job = transform(rows, 24)[0]
    assert job["resource_class"] == "C2"
    assert job["source_trace_id"] == "abcdef0123456789"
    assert "project-created" in job["transformation_notes"]["output_size_and_deadline"]
