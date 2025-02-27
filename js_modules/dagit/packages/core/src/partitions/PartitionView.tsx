import * as React from 'react';
import styled from 'styled-components/macro';

import {showCustomAlert} from '../app/CustomAlertProvider';
import {useFeatureFlags} from '../app/Flags';
import {DISABLED_MESSAGE, usePermissions} from '../app/Permissions';
import {PythonErrorInfo} from '../app/PythonErrorInfo';
import {useQueryPersistedState} from '../hooks/useQueryPersistedState';
import {useQueryPersistedRunFilters} from '../runs/RunsFilter';
import {Box} from '../ui/Box';
import {ButtonWIP} from '../ui/Button';
import {CursorHistoryControls} from '../ui/CursorControls';
import {DialogWIP} from '../ui/Dialog';
import {IconWIP} from '../ui/Icon';
import {Spinner} from '../ui/Spinner';
import {Tooltip} from '../ui/Tooltip';
import {RepoAddress} from '../workspace/types';

import {PartitionGraphSet} from './PartitionGraphSet';
import {PartitionPageSizeSelector} from './PartitionPageSizeSelector';
import {PartitionRunMatrix} from './PartitionRunMatrix';
import {PartitionSetSelector} from './PartitionSetSelector';
import {PartitionsBackfillPartitionSelector} from './PartitionsBackfill';
import {RunTagsSupportedTokens} from './RunTagsTokenizingField';
import {PipelinePartitionsRootQuery_partitionSetsOrError_PartitionSets_results} from './types/PipelinePartitionsRootQuery';
import {useChunkedPartitionsQuery} from './useChunkedPartitionsQuery';

type PartitionSet = PipelinePartitionsRootQuery_partitionSetsOrError_PartitionSets_results;

interface PartitionViewProps {
  pipelineName: string;
  pipelineMode: string;
  partitionSet: PartitionSet;
  partitionSets: PartitionSet[];
  onChangePartitionSet: (set: PartitionSet) => void;
  repoAddress: RepoAddress;
}

export const PartitionView: React.FC<PartitionViewProps> = ({
  pipelineName,
  pipelineMode,
  partitionSet,
  partitionSets,
  onChangePartitionSet,
  repoAddress,
}) => {
  const {flagPipelineModeTuples} = useFeatureFlags();
  const [runTags, setRunTags] = useQueryPersistedRunFilters(RunTagsSupportedTokens);
  const [stepQuery = '', setStepQuery] = useQueryPersistedState<string>({queryKey: 'stepQuery'});
  const [showBackfillSetup, setShowBackfillSetup] = React.useState(false);
  const [blockDialog, setBlockDialog] = React.useState(false);
  const {
    loading,
    error,
    loadingPercent,
    partitions,
    paginationProps,
    pageSize,
    setPageSize,
  } = useChunkedPartitionsQuery(partitionSet.name, runTags, repoAddress);
  const {canLaunchPartitionBackfill} = usePermissions();
  const onSubmit = React.useCallback(() => setBlockDialog(true), []);
  React.useEffect(() => {
    if (error) {
      showCustomAlert({
        body: <PythonErrorInfo error={error} />,
      });
    }
  }, [error]);

  const allStepKeys = new Set<string>();
  partitions.forEach((partition) => {
    partition.runs.forEach((run) => {
      run.stepStats.forEach((stat) => {
        allStepKeys.add(stat.stepKey);
      });
    });
  });

  const partitionSetsForMode = partitionSets.filter((result) => result.mode === pipelineMode);

  const launchButton = () => {
    if (!canLaunchPartitionBackfill) {
      return (
        <Tooltip content={DISABLED_MESSAGE}>
          <ButtonWIP icon={<IconWIP name="add_circle" />} disabled>
            Launch backfill
          </ButtonWIP>
        </Tooltip>
      );
    }

    return (
      <ButtonWIP
        onClick={() => setShowBackfillSetup(!showBackfillSetup)}
        icon={<IconWIP name="add_circle" />}
        active={showBackfillSetup}
      >
        Launch backfill
      </ButtonWIP>
    );
  };

  return (
    <div>
      <DialogWIP
        canEscapeKeyClose={!blockDialog}
        canOutsideClickClose={!blockDialog}
        onClose={() => setShowBackfillSetup(false)}
        style={{width: 800}}
        title={`Launch ${partitionSet.name} backfill`}
        isOpen={showBackfillSetup}
      >
        {showBackfillSetup && (
          <PartitionsBackfillPartitionSelector
            partitionSetName={partitionSet.name}
            pipelineName={pipelineName}
            onLaunch={(backfillId, stepQuery) => {
              setStepQuery(stepQuery);
              setRunTags([{token: 'tag', value: `dagster/backfill=${backfillId}`}]);
              setShowBackfillSetup(false);
            }}
            onSubmit={onSubmit}
            repoAddress={repoAddress}
          />
        )}
      </DialogWIP>
      <PartitionPagerContainer>
        {flagPipelineModeTuples && partitionSetsForMode.length <= 1 ? null : (
          <>
            <PartitionSetSelector
              selected={partitionSet}
              partitionSets={partitionSets}
              onSelect={onChangePartitionSet}
            />
            <div style={{width: 10, height: 10}} />
          </>
        )}
        <Box flex={{justifyContent: 'space-between', alignItems: 'center'}} style={{flex: 1}}>
          {launchButton()}
          {loading && (
            <Box
              margin={{horizontal: 8}}
              flex={{alignItems: 'center'}}
              style={{overflow: 'hidden'}}
            >
              <Spinner purpose="body-text" value={loadingPercent} />
              <div style={{width: 5, flexShrink: 0}} />
              <div style={{overflow: 'hidden', textOverflow: 'ellipsis'}}>
                Loading&nbsp;partitions…
              </div>
            </Box>
          )}
          <div style={{flex: 1}} />
          <PartitionPageSizeSelector
            value={paginationProps.hasPrevCursor ? undefined : pageSize}
            onChange={(value) => {
              setPageSize(value);
              paginationProps.reset();
            }}
          />
          <div style={{width: 10}} />
          <CursorHistoryControls {...paginationProps} />
        </Box>
      </PartitionPagerContainer>
      <div style={{position: 'relative'}}>
        <PartitionRunMatrix
          partitions={partitions}
          pipelineName={pipelineName}
          repoAddress={repoAddress}
          runTags={runTags}
          setRunTags={setRunTags}
          stepQuery={stepQuery}
          setStepQuery={setStepQuery}
        />
        <PartitionGraphSet partitions={partitions} allStepKeys={Array.from(allStepKeys).sort()} />
      </div>
    </div>
  );
};

const PartitionPagerContainer = styled.div`
  display: flex;
  align-items: center;
  justify-content: space-between;
  margin-bottom: 10px;
  flex-direction: row;

  @media (max-width: 1000px) {
    flex-direction: column;
    align-items: stretch;
  }
`;
