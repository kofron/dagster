import * as React from 'react';
import styled from 'styled-components/macro';

import {ButtonWIP} from './Button';
import {ButtonGroup} from './ButtonGroup';
import {ColorsWIP} from './Colors';
import {IconWIP} from './Icon';

const DIVIDER_THICKNESS = 2;

interface SplitPanelContainerProps {
  axis?: 'horizontal' | 'vertical';
  identifier: string;
  first: React.ReactNode;
  firstInitialPercent: number;
  firstMinSize?: number;
  second: React.ReactNode;
}

interface SplitPanelContainerState {
  size: number;
  key: string;
  resizing: boolean;
}

export class SplitPanelContainer extends React.Component<
  SplitPanelContainerProps,
  SplitPanelContainerState
> {
  constructor(props: SplitPanelContainerProps) {
    super(props);

    const key = `dagit.panel-width.${this.props.identifier}`;
    const value = window.localStorage.getItem(key);
    let size = Number(value);
    if (value === null || isNaN(size)) {
      size = this.props.firstInitialPercent;
    }

    this.state = {size, key, resizing: false};
  }

  onChangeSize = (size: number) => {
    this.setState({size});
    window.localStorage.setItem(this.state.key, `${size}`);
  };

  render() {
    const {firstMinSize, first, second} = this.props;
    const {size, resizing} = this.state;
    const axis = this.props.axis || 'horizontal';

    const firstPaneStyles: React.CSSProperties = {flexShrink: 0};

    // Note: The divider appears after the first panel, so making the first panel 100% wide
    // hides the divider offscreen. To prevent this, we subtract the divider depth.
    if (axis === 'horizontal') {
      firstPaneStyles.minWidth = firstMinSize;
      firstPaneStyles.width = `calc(${size}% - ${DIVIDER_THICKNESS}px)`;
    } else {
      firstPaneStyles.minHeight = firstMinSize;
      firstPaneStyles.height = `calc(${size}% - ${DIVIDER_THICKNESS}px)`;
    }

    return (
      <Container axis={axis} id="split-panel-container" resizing={resizing}>
        <div className="split-panel" style={firstPaneStyles}>
          {first}
        </div>
        <PanelDivider
          axis={axis}
          resizing={resizing}
          onSetResizing={(resizing) => this.setState({resizing})}
          onMove={this.onChangeSize}
        />
        <div className="split-panel" style={{flex: 1}}>
          {second}
        </div>
      </Container>
    );
  }
}

interface IDividerProps {
  axis: 'horizontal' | 'vertical';
  resizing: boolean;
  onSetResizing: (resizing: boolean) => void;
  onMove: (vw: number) => void;
}

class PanelDivider extends React.Component<IDividerProps> {
  ref = React.createRef<any>();

  onMouseDown = (e: React.MouseEvent) => {
    e.preventDefault();

    this.props.onSetResizing(true);

    const onMouseMove = (event: MouseEvent) => {
      const parent = this.ref.current?.closest('#split-panel-container');
      if (!parent) {
        return;
      }
      const parentRect = parent.getBoundingClientRect();

      const firstPanelPercent =
        this.props.axis === 'horizontal'
          ? ((event.clientX - parentRect.left) * 100) / parentRect.width
          : ((event.clientY - parentRect.top) * 100) / parentRect.height;

      this.props.onMove(Math.min(100, Math.max(0, firstPanelPercent)));
    };

    const onMouseUp = () => {
      this.props.onSetResizing(false);
      document.removeEventListener('mousemove', onMouseMove);
      document.removeEventListener('mouseup', onMouseUp);
    };
    document.addEventListener('mousemove', onMouseMove);
    document.addEventListener('mouseup', onMouseUp);
  };

  render() {
    const Wrapper = DividerWrapper[this.props.axis];
    const HitArea = DividerHitArea[this.props.axis];
    return (
      <Wrapper resizing={this.props.resizing} ref={this.ref}>
        <HitArea onMouseDown={this.onMouseDown} />
      </Wrapper>
    );
  }
}

interface PanelToggleProps {
  axis: 'horizontal' | 'vertical';
  container: React.RefObject<SplitPanelContainer>;
}

export const FirstOrSecondPanelToggle = ({container, axis}: PanelToggleProps) => {
  // todo dish/bengotow: Fix these icons.
  return (
    <ButtonGroup
      buttons={[
        {
          id: 'first-pane',
          icon: axis === 'vertical' ? 'vertical_align_bottom' : 'vertical_align_bottom',
        },
        {
          id: 'second-pane',
          icon: axis === 'vertical' ? 'vertical_align_top' : 'vertical_align_top',
        },
      ]}
      onClick={(id) => container.current?.onChangeSize(id === 'first-pane' ? 100 : 0)}
    />
  );
};

// Todo: This component attempts to sync itself with the container, but it can't
// observe the container's width without a React context or adding a listener, etc.
// If we keep making components that manipulate panel state we may want to move it
// all to a context consumed by both.
//
export const SecondPanelToggle = ({container, axis}: PanelToggleProps) => {
  const [prevSize, setPrevSize] = React.useState<number | 'unknown'>('unknown');
  const initialIsOpen = (container.current?.state.size || 0) < 100;

  const [open, setOpen] = React.useState<boolean>(initialIsOpen);
  React.useEffect(() => setOpen(initialIsOpen), [initialIsOpen]);

  return (
    <ButtonWIP
      active={open}
      title="Toggle Second Pane"
      icon={<IconWIP name={axis === 'vertical' ? 'vertical_align_top' : 'vertical_align_top'} />}
      onClick={() => {
        if (!container.current) {
          return;
        }
        const current = container.current.state.size;
        if (current < 90) {
          setPrevSize(current);
          setOpen(false);
          container.current.onChangeSize(100);
        } else {
          setOpen(true);
          container.current.onChangeSize(
            prevSize === 'unknown' ? container.current.props.firstInitialPercent : prevSize,
          );
        }
      }}
    />
  );
};

// Note: -1px margins here let the divider cover the last 1px of the previous box, hiding
// any scrollbar border it might have.

const DividerWrapper = {
  horizontal: styled.div<{resizing: boolean}>`
    width: ${DIVIDER_THICKNESS}px;
    z-index: 1;
    background: ${(p) => (p.resizing ? ColorsWIP.Gray400 : ColorsWIP.KeylineGray)};
    margin-left: -1px;
    overflow: visible;
    position: relative;
  `,
  vertical: styled.div<{resizing: boolean}>`
    height: ${DIVIDER_THICKNESS}px;
    z-index: 1;
    background: ${(p) => (p.resizing ? ColorsWIP.Gray400 : ColorsWIP.KeylineGray)};
    margin-top: -1px;
    overflow: visible;
    position: relative;
  `,
};

const DividerHitArea = {
  horizontal: styled.div`
    width: 17px;
    height: 100%;
    z-index: 1;
    cursor: ew-resize;
    position: relative;
    left: -8px;
  `,
  vertical: styled.div`
    height: 17px;
    width: 100%;
    z-index: 1;
    cursor: ns-resize;
    position: relative;
    top: -8px;
  `,
};

const Container = styled.div<{
  axis?: 'horizontal' | 'vertical';
  resizing: boolean;
}>`
  display: flex;
  flex-direction: ${({axis}) => (axis === 'vertical' ? 'column' : 'row')};
  flex: 1 1;
  width: 100%;
  min-width: 0;
  min-height: 0;

  .split-panel {
    position: relative;
    transition: ${({axis, resizing}) =>
      resizing ? 'none' : axis === 'horizontal' ? 'width' : 'height'}
      200ms ease-out;
    flex-direction: column;
    display: flex;
    min-${({axis}) => (axis === 'vertical' ? 'height' : 'width')}: 0;
    z-index: 0;
  }
`;
