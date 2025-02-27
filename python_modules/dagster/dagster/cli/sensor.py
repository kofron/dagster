import os
import sys

import click
import yaml
from dagster import DagsterInvariantViolationError
from dagster import __version__ as dagster_version
from dagster import check
from dagster.cli.workspace.cli_target import (
    get_external_repository_from_kwargs,
    get_external_repository_from_repo_location,
    get_repository_location_from_kwargs,
    repository_target_argument,
)
from dagster.core.definitions.run_request import JobType
from dagster.core.host_representation import ExternalRepository
from dagster.core.instance import DagsterInstance
from dagster.core.scheduler.job import JobState, JobStatus, SensorJobData
from dagster.utils.error import serializable_error_info_from_exc_info


@click.group(name="sensor")
def sensor_cli():
    """
    Commands for working with Dagster sensors.
    """


def print_changes(external_repository, instance, print_fn=print, preview=False):
    sensor_states = instance.all_stored_job_state(
        external_repository.get_origin_id(), JobType.SENSOR
    )
    external_sensors = external_repository.get_external_sensors()
    external_sensors_dict = {s.get_external_origin_id(): s for s in external_sensors}
    sensor_states_dict = {s.job_origin_id: s for s in sensor_states}

    external_sensor_origin_ids = set(external_sensors_dict.keys())
    sensor_state_ids = set(sensor_states_dict.keys())

    added_sensors = external_sensor_origin_ids - sensor_state_ids
    removed_sensors = sensor_state_ids - external_sensor_origin_ids

    if not added_sensors and not removed_sensors:
        if preview:
            print_fn(click.style("No planned changes to sensors.", fg="magenta", bold=True))
            print_fn("{num} sensors will remain unchanged".format(num=len(external_sensors)))
        else:
            print_fn(click.style("No changes to sensors.", fg="magenta", bold=True))
            print_fn("{num} sensors unchanged".format(num=len(external_sensors)))
        return

    print_fn(
        click.style("Planned Sensor Changes:" if preview else "Changes:", fg="magenta", bold=True)
    )

    for sensor_origin_id in added_sensors:
        print_fn(
            click.style(
                "  + {name} (add) [{id}]".format(
                    name=external_sensors_dict[sensor_origin_id].name, id=sensor_origin_id
                ),
                fg="green",
            )
        )

    for sensor_origin_id in removed_sensors:
        print_fn(
            click.style(
                "  + {name} (delete) [{id}]".format(
                    name=external_sensors_dict[sensor_origin_id].name, id=sensor_origin_id
                ),
                fg="red",
            )
        )


def check_repo_and_scheduler(repository, instance):
    check.inst_param(repository, "repository", ExternalRepository)
    check.inst_param(instance, "instance", DagsterInstance)

    repository_name = repository.name

    if not repository.get_external_sensors():
        raise click.UsageError(
            "There are no sensors defined for repository {name}.".format(name=repository_name)
        )

    if not os.getenv("DAGSTER_HOME"):
        raise click.UsageError(
            (
                "The environment variable $DAGSTER_HOME is not set. Dagster requires this "
                "environment variable to be set to an existing directory in your filesystem "
                "that contains your dagster instance configuration file (dagster.yaml).\n"
                "You can resolve this error by exporting the environment variable."
                "For example, you can run the following command in your shell or "
                "include it in your shell configuration file:\n"
                '\texport DAGSTER_HOME="~/dagster_home"'
                "\n\n"
            )
        )


def extract_sensor_name(sensor_name):
    if not sensor_name:
        raise click.UsageError("Missing sensor name argument")

    if isinstance(sensor_name, str):
        return sensor_name

    if len(sensor_name) == 1:
        return sensor_name[0]

    raise click.UsageError("Missing sensor name argument")


@sensor_cli.command(
    name="list",
    help="List all sensors that correspond to a repository.",
)
@repository_target_argument
@click.option("--running", help="Filter for running sensors", is_flag=True, default=False)
@click.option("--stopped", help="Filter for stopped sensors", is_flag=True, default=False)
@click.option("--name", help="Only display sensor sensor names", is_flag=True, default=False)
def sensor_list_command(running, stopped, name, **kwargs):
    return execute_list_command(running, stopped, name, kwargs, click.echo)


def execute_list_command(running_filter, stopped_filter, name_filter, cli_args, print_fn):
    with DagsterInstance.get() as instance:
        with get_external_repository_from_kwargs(
            instance, version=dagster_version, kwargs=cli_args
        ) as external_repo:
            check_repo_and_scheduler(external_repo, instance)
            repository_name = external_repo.name

            if not name_filter:
                title = "Repository {name}".format(name=repository_name)
                print_fn(title)
                print_fn("*" * len(title))

            repo_sensors = external_repo.get_external_sensors()
            stored_sensors_by_origin_id = {
                stored_sensor_state.job_origin_id: stored_sensor_state
                for stored_sensor_state in instance.all_stored_job_state(
                    external_repo.get_external_origin_id(), job_type=JobType.SENSOR
                )
            }

            first = True

            for external_sensor in repo_sensors:
                stored_sensor_state = stored_sensors_by_origin_id.get(
                    external_sensor.get_external_origin_id()
                )
                if running_filter and (
                    not stored_sensor_state or stored_sensor_state.status == JobStatus.STOPPED
                ):
                    continue
                if stopped_filter and stored_sensor_state and JobStatus.RUNNING:
                    continue

                if name_filter:
                    print_fn(external_sensor.name)
                    continue

                status = stored_sensor_state.status if stored_sensor_state else JobStatus.STOPPED
                sensor_title = f"Sensor: {external_sensor.name} [{status.value}]"
                if not first:
                    print_fn("*" * len(sensor_title))

                first = False

                print_fn(sensor_title)


@sensor_cli.command(name="start", help="Start an existing sensor.")
@click.argument("sensor_name", nargs=-1)  # , required=True)
@click.option("--start-all", help="start all sensors", is_flag=True, default=False)
@repository_target_argument
def sensor_start_command(sensor_name, start_all, **kwargs):
    if not start_all:
        sensor_name = extract_sensor_name(sensor_name)
    return execute_start_command(sensor_name, start_all, kwargs, click.echo)


def execute_start_command(sensor_name, all_flag, cli_args, print_fn):
    with DagsterInstance.get() as instance:
        with get_external_repository_from_kwargs(
            instance, version=dagster_version, kwargs=cli_args
        ) as external_repo:
            check_repo_and_scheduler(external_repo, instance)
            repository_name = external_repo.name

            if all_flag:
                try:
                    for external_sensor in external_repo.get_external_sensors():
                        instance.start_sensor(external_sensor)
                    print_fn(
                        "Started all sensors for repository {repository_name}".format(
                            repository_name=repository_name
                        )
                    )
                except DagsterInvariantViolationError as ex:
                    raise click.UsageError(ex)
            else:
                try:
                    external_sensor = external_repo.get_external_sensor(sensor_name)
                    instance.start_sensor(external_sensor)
                except DagsterInvariantViolationError as ex:
                    raise click.UsageError(ex)

                print_fn("Started sensor {sensor_name}".format(sensor_name=sensor_name))


@sensor_cli.command(name="stop", help="Stop an existing sensor.")
@click.argument("sensor_name", nargs=-1)
@repository_target_argument
def sensor_stop_command(sensor_name, **kwargs):
    sensor_name = extract_sensor_name(sensor_name)
    return execute_stop_command(sensor_name, kwargs, click.echo)


def execute_stop_command(sensor_name, cli_args, print_fn):
    with DagsterInstance.get() as instance:
        with get_external_repository_from_kwargs(
            instance, version=dagster_version, kwargs=cli_args
        ) as external_repo:
            check_repo_and_scheduler(external_repo, instance)
            try:
                external_sensor = external_repo.get_external_sensor(sensor_name)
                instance.stop_sensor(external_sensor.get_external_origin_id())
            except DagsterInvariantViolationError as ex:
                raise click.UsageError(ex)

            print_fn("Stopped sensor {sensor_name}".format(sensor_name=sensor_name))


@sensor_cli.command(name="preview", help="Preview an existing sensor execution.")
@click.argument("sensor_name", nargs=-1)
@click.option(
    "--since",
    help="Set the last_completion_time value as a timestamp float for the sensor context",
    default=None,
)
@click.option(
    "--last_run_key",
    help="Set the last_run_key value for the sensor context",
    default=None,
)
@click.option(
    "--cursor",
    help="Set the cursor value for the sensor context",
    default=None,
)
@repository_target_argument
def sensor_preview_command(sensor_name, since, last_run_key, cursor, **kwargs):
    sensor_name = extract_sensor_name(sensor_name)
    if since:
        since = float(since)
    return execute_preview_command(sensor_name, since, last_run_key, cursor, kwargs, click.echo)


def execute_preview_command(
    sensor_name, since, last_run_key, cursor, cli_args, print_fn, instance=None
):
    with DagsterInstance.get() as instance:
        with get_repository_location_from_kwargs(
            instance,
            version=dagster_version,
            kwargs=cli_args,
        ) as repo_location:
            try:
                external_repo = get_external_repository_from_repo_location(
                    repo_location, cli_args.get("repository")
                )
                check_repo_and_scheduler(external_repo, instance)
                external_sensor = external_repo.get_external_sensor(sensor_name)
                try:
                    sensor_runtime_data = repo_location.get_external_sensor_execution_data(
                        instance,
                        external_repo.handle,
                        external_sensor.name,
                        since,
                        last_run_key,
                        cursor,
                    )
                except Exception:  # pylint: disable=broad-except
                    error_info = serializable_error_info_from_exc_info(sys.exc_info())
                    print_fn(
                        "Failed to resolve sensor for {sensor_name} : {error_info}".format(
                            sensor_name=external_sensor.name,
                            error_info=error_info.to_string(),
                        )
                    )
                    return

                if not sensor_runtime_data.run_requests:
                    if sensor_runtime_data.skip_message:
                        print_fn(
                            "Sensor returned false for {sensor_name}, skipping: {skip_message}".format(
                                sensor_name=external_sensor.name,
                                skip_message=sensor_runtime_data.skip_message,
                            )
                        )
                    else:
                        print_fn(
                            "Sensor returned false for {sensor_name}, skipping".format(
                                sensor_name=external_sensor.name
                            )
                        )
                else:
                    print_fn(
                        "Sensor returning run requests for {num} run(s):\n\n{run_requests}".format(
                            num=len(sensor_runtime_data.run_requests),
                            run_requests="\n".join(
                                yaml.safe_dump(run_request.run_config, default_flow_style=False)
                                for run_request in sensor_runtime_data.run_requests
                            ),
                        )
                    )

            except DagsterInvariantViolationError as ex:
                raise click.UsageError(ex)


@sensor_cli.command(name="cursor", help="Set the cursor value for an existing sensor.")
@click.argument("sensor_name", nargs=-1)
@click.option(
    "--set",
    help="Set the cursor value for the sensor context",
    default=None,
)
@click.option(
    "--delete", help="Delete the existing cursor value for the sensor context", is_flag=True
)
@repository_target_argument
def sensor_cursor_command(sensor_name, **kwargs):
    sensor_name = extract_sensor_name(sensor_name)
    return execute_cursor_command(sensor_name, kwargs, click.echo)


def execute_cursor_command(sensor_name, cli_args, print_fn):
    with DagsterInstance.get() as instance:
        with get_repository_location_from_kwargs(
            instance, version=dagster_version, kwargs=cli_args
        ) as repo_location:
            if bool(cli_args.get("delete")) == bool(cli_args.get("set")):
                # must use one of delete/set
                raise click.UsageError("Must set cursor using `--set <value>` or use `--delete`")

            cursor_value = cli_args.get("set")

            external_repo = get_external_repository_from_repo_location(
                repo_location, cli_args.get("repository")
            )
            check_repo_and_scheduler(external_repo, instance)
            external_sensor = external_repo.get_external_sensor(sensor_name)
            job_state = instance.get_job_state(external_sensor.get_external_origin_id())
            if not job_state:
                instance.add_job_state(
                    JobState(
                        external_sensor.get_external_origin(),
                        JobType.SENSOR,
                        JobStatus.STOPPED,
                        SensorJobData(
                            min_interval=external_sensor.min_interval_seconds, cursor=cursor_value
                        ),
                    )
                )
            else:
                instance.update_job_state(
                    job_state.with_data(
                        SensorJobData(
                            last_tick_timestamp=job_state.job_specific_data.last_tick_timestamp,
                            last_run_key=job_state.job_specific_data.last_run_key,
                            min_interval=external_sensor.min_interval_seconds,
                            cursor=cursor_value,
                        ),
                    )
                )
            if cursor_value:
                print_fn(f'Set cursor state for sensor {external_sensor.name} to "{cursor_value}"')
            else:
                print_fn(f"Cleared cursor state for sensor {external_sensor.name}")
