import {gql} from '@apollo/client';
import * as React from 'react';
import {Link} from 'react-router-dom';
import styled from 'styled-components/macro';

import {useFeatureFlags} from '../app/Flags';
import {usePermissions} from '../app/Permissions';
import {PYTHON_ERROR_FRAGMENT} from '../app/PythonErrorInfo';
import {useSelectionReducer} from '../hooks/useSelectionReducer';
import {PipelineSnapshotLink} from '../pipelines/PipelinePathUtils';
import {PipelineReference} from '../pipelines/PipelineReference';
import {Box} from '../ui/Box';
import {Checkbox} from '../ui/Checkbox';
import {ColorsWIP} from '../ui/Colors';
import {IconWIP} from '../ui/Icon';
import {NonIdealState} from '../ui/NonIdealState';
import {Table} from '../ui/Table';
import {Mono} from '../ui/Text';
import {TokenizingFieldValue} from '../ui/TokenizingField';
import {workspacePipelinePathGuessRepo} from '../workspace/workspacePath';

import {RunActionsMenu, RunBulkActionsMenu} from './RunActionsMenu';
import {RunStatusTagWithStats} from './RunStatusTag';
import {canceledStatuses, queuedStatuses} from './RunStatuses';
import {RunTags} from './RunTags';
import {RunElapsed, RunTime, RUN_TIME_FRAGMENT, titleForRun} from './RunUtils';
import {RunTableRunFragment} from './types/RunTableRunFragment';

interface RunTableProps {
  runs: RunTableRunFragment[];
  onSetFilter: (search: TokenizingFieldValue[]) => void;
  nonIdealState?: React.ReactNode;
  actionBarComponents?: React.ReactNode;
  highlightedIds?: string[];
  additionalColumnHeaders?: React.ReactNode[];
  additionalColumnsForRow?: (run: RunTableRunFragment) => React.ReactNode[];
}

export const RunTable = (props: RunTableProps) => {
  const {flagPipelineModeTuples} = useFeatureFlags();
  const {runs, onSetFilter, nonIdealState, highlightedIds, actionBarComponents} = props;
  const allIds = runs.map((r) => r.runId);

  const [{checkedIds}, {onToggleFactory, onToggleAll}] = useSelectionReducer(allIds);

  const {canTerminatePipelineExecution, canDeletePipelineRun} = usePermissions();
  const canTerminateOrDelete = canTerminatePipelineExecution || canDeletePipelineRun;

  if (runs.length === 0) {
    return (
      <div>
        <Box padding={{vertical: 8, left: 24, right: 12}}>{actionBarComponents}</Box>
        <Box margin={{vertical: 64}}>
          {nonIdealState || (
            <NonIdealState
              icon="run"
              title="No runs to display"
              description="Use the Playground to launch a run."
            />
          )}
        </Box>
      </div>
    );
  }

  const selectedFragments = runs.filter((run) => checkedIds.has(run.runId));

  return (
    <>
      <Box flex={{alignItems: 'center', gap: 12}} padding={{vertical: 8, left: 24, right: 12}}>
        {actionBarComponents}
        <div style={{flex: 1}} />
        <RunBulkActionsMenu
          selected={selectedFragments}
          clearSelection={() => onToggleAll(false)}
        />
      </Box>

      <Table>
        <thead>
          <tr>
            <th style={{paddingTop: 0, paddingBottom: 0}}>
              {canTerminateOrDelete ? (
                <Checkbox
                  indeterminate={checkedIds.size > 0 && checkedIds.size !== runs.length}
                  checked={checkedIds.size === runs.length}
                  onChange={(e: React.FormEvent<HTMLInputElement>) => {
                    if (e.target instanceof HTMLInputElement) {
                      onToggleAll(e.target.checked);
                    }
                  }}
                />
              ) : null}
            </th>
            <th>Status</th>
            <th>Run ID</th>
            <th>{flagPipelineModeTuples ? 'Job' : 'Pipeline'}</th>
            <th style={{width: 120, minWidth: 120}}>Snapshot ID</th>
            <th style={{width: 180}}>Timing</th>
            {props.additionalColumnHeaders}
            <th style={{width: 52}} />
          </tr>
        </thead>
        <tbody>
          {runs.map((run) => (
            <RunRow
              canTerminateOrDelete={canTerminateOrDelete}
              run={run}
              key={run.runId}
              onSetFilter={onSetFilter}
              checked={checkedIds.has(run.runId)}
              additionalColumns={props.additionalColumnsForRow?.(run)}
              onToggleChecked={onToggleFactory(run.runId)}
              isHighlighted={highlightedIds && highlightedIds.includes(run.runId)}
            />
          ))}
        </tbody>
      </Table>
    </>
  );
};

export const RUN_TABLE_RUN_FRAGMENT = gql`
  fragment RunTableRunFragment on PipelineRun {
    id
    runId
    status
    stepKeysToExecute
    canTerminate
    mode
    rootRunId
    parentRunId
    pipelineSnapshotId
    pipelineName
    solidSelection
    status
    tags {
      key
      value
    }
    ...RunTimeFragment
  }

  ${PYTHON_ERROR_FRAGMENT}
  ${RUN_TIME_FRAGMENT}
`;

const RunRow: React.FC<{
  run: RunTableRunFragment;
  canTerminateOrDelete: boolean;
  onSetFilter: (search: TokenizingFieldValue[]) => void;
  checked?: boolean;
  onToggleChecked?: (values: {checked: boolean; shiftKey: boolean}) => void;
  additionalColumns?: React.ReactNode[];
  isHighlighted?: boolean;
}> = ({
  run,
  canTerminateOrDelete,
  onSetFilter,
  checked,
  onToggleChecked,
  additionalColumns,
  isHighlighted,
}) => {
  const onChange = (e: React.FormEvent<HTMLInputElement>) => {
    if (e.target instanceof HTMLInputElement) {
      const {checked} = e.target;
      const shiftKey =
        e.nativeEvent instanceof MouseEvent && e.nativeEvent.getModifierState('Shift');
      onToggleChecked && onToggleChecked({checked, shiftKey});
    }
  };

  return (
    <Row key={run.runId} highlighted={!!isHighlighted}>
      <td>
        {canTerminateOrDelete && onToggleChecked ? (
          <Checkbox checked={!!checked} onChange={onChange} />
        ) : null}
      </td>
      <td>
        <RunStatusTagWithStats status={run.status} runId={run.runId} />
      </td>
      <td>
        <Link to={`/instance/runs/${run.runId}`}>
          <Mono>{titleForRun(run)}</Mono>
        </Link>
      </td>
      <td>
        <Box flex={{direction: 'column', gap: 5}}>
          <Box flex={{direction: 'row', gap: 8, alignItems: 'center'}}>
            <PipelineReference
              mode={run.mode}
              pipelineName={run.pipelineName}
              pipelineHrefContext="no-link"
            />
            <Link to={workspacePipelinePathGuessRepo(run.pipelineName, run.mode)}>
              <IconWIP name="open_in_new" color={ColorsWIP.Blue500} />
            </Link>
          </Box>
          <RunTags tags={run.tags} onSetFilter={onSetFilter} />
        </Box>
      </td>
      <td>
        <PipelineSnapshotLink
          snapshotId={run.pipelineSnapshotId || ''}
          pipelineMode={run.mode}
          pipelineName={run.pipelineName}
        />
      </td>
      <td>
        <RunTime run={run} />
        {queuedStatuses.has(run.status) || canceledStatuses.has(run.status) ? null : (
          <RunElapsed run={run} />
        )}
      </td>
      {additionalColumns}
      <td>
        <RunActionsMenu run={run} />
      </td>
    </Row>
  );
};

const Row = styled.tr<{highlighted: boolean}>`
  ${({highlighted}) =>
    highlighted ? `box-shadow: inset 3px 3px #bfccd6, inset -3px -3px #bfccd6;` : null}
`;
