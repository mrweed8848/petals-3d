import { memo } from 'react'
import {
    IconArrowsHorizontal,
    IconCircle,
    IconDropletHalf2,
    IconFlipHorizontal,
    IconLine,
    IconPalette,
    IconScribble,
    IconVectorSpline,
} from '@tabler/icons-react'
import { useShallow } from 'zustand/react/shallow'

import FlatShadeIcon from '../svg-icons/FlatShadeIcon'
import GlowShadeIcon from '../svg-icons/GlowShadeIcon'
import CubeStrokeIcon from '../svg-icons/CubeStrokeIcon'
import BeltStrokeIcon from '../svg-icons/BeltStrokeIcon'
import TaperStrokeIcon from '../svg-icons/TaperStrokeIcon'
import PaintStrokeIcon from '../svg-icons/PaintStrokeIcon'
import StableStrokIcon from '../svg-icons/StableStrokIcon'
import RespondShadeIcon from '../svg-icons/RespondShadeIcon'
import PressureActiveIcon from '../svg-icons/PressureActiveIcon'
import PressureInActiveIcon from '../svg-icons/PressureInActiveIcon'

import { canvasDrawStore } from '../../hooks/useCanvasDrawStore'

import ToolTip from '../ToolTip'
import ToolButton from '../ToolButton'
import ColorPicker from '../ColorPicker'
import RangeSlider from '../RangeSlider'

import {
    handleMirroring,
    handleShape,
    handleStroke,
} from '../../helpers/toolHelper'

export interface PenOptionsPanelProps {
    isSmall: boolean
}

/** Brush settings. Only one flyout is open at a time. */
const PenOptionsPanel = ({ isSmall }: PenOptionsPanelProps) => {
    const {
        mirror,
        setMirror,
        mirrorOptions,
        setMirrorOptions,
        strokeOpacity,
        setStrokeOpacity,
        penActive,
        strokeType,
        setStrokeType,
        strokeColor,
        setStrokeColor,
        strokeWidth,
        setStrokeWidth,
        pressureMode,
        setPressureMode,
        drawShapeType,
        setDrawShapeType,
        openWidthSlider,
        setOpenWidthSlider,
        openColorOptions,
        setOpenColorOptions,
        openStrokeOptions,
        setOpenStrokeOptions,
        openOpacitySlider,
        setOpenOpacitySlider,
        openDrawShapeOptions,
        setOpenDrawShapeOptions,
        activeMaterialType,
        setActiveMaterialType,
        openStrokeStabler,
        setOpenStrokeStabler,
        strokeStablePercentage,
        setStrokeStablePercentage,
    } = canvasDrawStore(
        useShallow((state) => ({
            mirror: state.mirror,
            setMirror: state.setMirror,
            mirrorOptions: state.mirrorOptions,
            setMirrorOptions: state.setMirrorOptions,
            strokeOpacity: state.strokeOpacity,
            setStrokeOpacity: state.setStrokeOpacity,
            penActive: state.penActive,
            strokeType: state.strokeType,
            setStrokeType: state.setStrokeType,
            strokeColor: state.strokeColor,
            setStrokeColor: state.setStrokeColor,
            strokeWidth: state.strokeWidth,
            setStrokeWidth: state.setStrokeWidth,
            pressureMode: state.pressureMode,
            setPressureMode: state.setPressureMode,
            drawShapeType: state.drawShapeType,
            setDrawShapeType: state.setDrawShapeType,
            openWidthSlider: state.openWidthSlider,
            setOpenWidthSlider: state.setOpenWidthSlider,
            openColorOptions: state.openColorOptions,
            setOpenColorOptions: state.setOpenColorOptions,
            openStrokeOptions: state.openStrokeOptions,
            setOpenStrokeOptions: state.setOpenStrokeOptions,
            openOpacitySlider: state.openOpacitySlider,
            setOpenOpacitySlider: state.setOpenOpacitySlider,
            openDrawShapeOptions: state.openDrawShapeOptions,
            setOpenDrawShapeOptions: state.setOpenDrawShapeOptions,
            activeMaterialType: state.activeMaterialType,
            setActiveMaterialType: state.setActiveMaterialType,
            openStrokeStabler: state.openStrokeStabler,
            setOpenStrokeStabler: state.setOpenStrokeStabler,
            strokeStablePercentage: state.strokeStablePercentage,
            setStrokeStablePercentage: state.setStrokeStablePercentage,
        }))
    )

    /** Only one flyout is open at a time, so opening any closes the rest. */
    function closeAllPanels() {
        setOpenColorOptions(false)
        setOpenStrokeOptions(false)
        setOpenOpacitySlider(false)
        setOpenWidthSlider(false)
        setMirrorOptions(false)
        setOpenStrokeStabler(false)
        setOpenDrawShapeOptions(false)
    }

    function handleStrokeOptions() {
        const next = !openStrokeOptions
        closeAllPanels()
        setOpenStrokeOptions(next)
    }

    function handleShapeOptions() {
        const next = !openDrawShapeOptions
        closeAllPanels()
        setOpenDrawShapeOptions(next)
    }

    function handleColorChange() {
        const next = !openColorOptions
        closeAllPanels()
        setOpenColorOptions(next)
    }

    function handleOpacityOptions() {
        const next = !openOpacitySlider
        closeAllPanels()
        setOpenOpacitySlider(next)
    }

    function handleWidthOptions() {
        const next = !openWidthSlider
        closeAllPanels()
        setOpenWidthSlider(next)
    }

    function handleMirrorOptions() {
        const next = !mirrorOptions
        closeAllPanels()
        setMirrorOptions(next)
    }

    function handleStableStrokeOptions() {
        const next = !openStrokeStabler
        closeAllPanels()
        setOpenStrokeStabler(next)
    }

    return (
        <div>
            {penActive && (
                <div className="absolute top-[72px] left-[12px] z-5 flex flex-col justify-center gap-[4px] rounded-[12px] border-[1px] border-line/25 bg-surface p-[4px] drop-shadow-xl">
                    <ToolTip text="Color Select" position="right" delay={100}>
                        <button
                            onClick={handleColorChange}
                            className="flex cursor-pointer items-center justify-center rounded-[8px] border-[0px] p-[8px] font-bold hover:bg-surface-3"
                        >
                            <IconPalette
                                color={strokeColor}
                                size={isSmall ? 12 : 20}
                                stroke={1.5}
                            />
                        </button>
                    </ToolTip>

                    <ToolTip text="Brushes" position="right" delay={100}>
                        <button
                            onClick={handleStrokeOptions}
                            className={`flex cursor-pointer justify-center rounded-[8px] border-[0px] p-[8px] font-bold hover:bg-surface-3`}
                        >
                            {strokeType === 'taper' && (
                                <TaperStrokeIcon
                                    color={strokeColor}
                                    size={isSmall ? 12 : 20}
                                />
                            )}
                            {strokeType === 'cube' && (
                                <CubeStrokeIcon
                                    color={strokeColor}
                                    size={isSmall ? 12 : 20}
                                />
                            )}
                            {strokeType === 'paint' && (
                                <PaintStrokeIcon
                                    color={strokeColor}
                                    size={isSmall ? 12 : 20}
                                />
                            )}
                            {strokeType === 'belt' && (
                                <BeltStrokeIcon
                                    color={strokeColor}
                                    size={isSmall ? 12 : 20}
                                />
                            )}
                        </button>
                    </ToolTip>

                    <ToolTip text="Draw Shape" position="right" delay={100}>
                        <button
                            onClick={handleShapeOptions}
                            className={`flex cursor-pointer justify-center rounded-[8px] border-[0px] p-[8px] font-bold ${
                                openDrawShapeOptions
                                    ? 'bg-accent text-accent-ink'
                                    : 'hover:bg-surface-3'
                            }`}
                        >
                            {drawShapeType === 'free_hand' && (
                                <IconScribble
                                    color="currentColor"
                                    size={isSmall ? 12 : 20}
                                    stroke={1.5}
                                />
                            )}
                            {drawShapeType === 'straight' && (
                                <IconLine
                                    color="currentColor"
                                    size={isSmall ? 12 : 20}
                                    stroke={1.5}
                                />
                            )}
                            {drawShapeType === 'circle' && (
                                <IconCircle
                                    color="currentColor"
                                    size={isSmall ? 12 : 20}
                                    stroke={1.5}
                                />
                            )}
                            {drawShapeType === 'arc' && (
                                <IconVectorSpline
                                    color="currentColor"
                                    size={isSmall ? 12 : 20}
                                    stroke={1.5}
                                />
                            )}
                        </button>
                    </ToolTip>

                    <ToolTip text="Opacity" position="right" delay={100}>
                        <div onClick={handleOpacityOptions}>
                            <ToolButton
                                condition={openOpacitySlider}
                                icon={
                                    <IconDropletHalf2
                                        color="currentColor"
                                        size={isSmall ? 12 : 20}
                                        opacity={strokeOpacity}
                                        stroke={1.5}
                                    />
                                }
                            />
                        </div>
                    </ToolTip>

                    <ToolTip text="Width" position="right" delay={100}>
                        <div onClick={handleWidthOptions}>
                            <ToolButton
                                condition={openWidthSlider}
                                icon={
                                    <IconArrowsHorizontal
                                        color="currentColor"
                                        size={isSmall ? 12 : 20}
                                        stroke={1.5}
                                    />
                                }
                            />
                        </div>
                    </ToolTip>

                    <ToolTip text="Stable Stroke" position="right" delay={100}>
                        <div onClick={handleStableStrokeOptions}>
                            <ToolButton
                                condition={openStrokeStabler}
                                icon={
                                    <StableStrokIcon
                                        color="currentColor"
                                        size={isSmall ? 12 : 20}
                                    />
                                }
                            />
                        </div>
                    </ToolTip>

                    {pressureMode ? (
                        <ToolTip
                            text="Pressure On"
                            position="right"
                            delay={100}
                        >
                            <div onClick={() => setPressureMode(false)}>
                                <ToolButton
                                    condition={false}
                                    icon={
                                        <PressureActiveIcon
                                            color="currentColor"
                                            size={isSmall ? 12 : 20}
                                        />
                                    }
                                />
                            </div>
                        </ToolTip>
                    ) : (
                        <ToolTip
                            text="Pressure Off"
                            position="right"
                            delay={100}
                        >
                            <div onClick={() => setPressureMode(true)}>
                                <ToolButton
                                    condition={false}
                                    icon={
                                        <PressureInActiveIcon
                                            color="currentColor"
                                            size={isSmall ? 12 : 20}
                                        />
                                    }
                                />
                            </div>
                        </ToolTip>
                    )}

                    <ToolTip text="Mirror" position="right" delay={100}>
                        <div onClick={handleMirrorOptions}>
                            <ToolButton
                                condition={mirrorOptions}
                                icon={
                                    <IconFlipHorizontal
                                        color="currentColor"
                                        size={isSmall ? 12 : 20}
                                        stroke={1.5}
                                    />
                                }
                            />
                        </div>
                    </ToolTip>
                </div>
            )}

            {penActive && openColorOptions && (
                <div className="absolute top-[72px] left-[72px] z-5 rounded-[12px] border-[1px] border-line/25 bg-surface p-[4px] drop-shadow-xl">
                    <ColorPicker
                        value={strokeColor}
                        onChange={setStrokeColor}
                        isSmall={isSmall}
                    />
                    <div className="mx-[8px] my-[12px] font-funnel text-[8px] font-normal text-ink md:text-[12px]">
                        Material
                    </div>
                    <div className="mt-[12px] flex items-center justify-around">
                        <ToolTip text="Flat" position="bottom" delay={100}>
                            <div onClick={() => setActiveMaterialType('flat')}>
                                <ToolButton
                                    condition={activeMaterialType === 'flat'}
                                    icon={
                                        <FlatShadeIcon
                                            color="currentColor"
                                            size={isSmall ? 20 : 32}
                                        />
                                    }
                                />
                            </div>
                        </ToolTip>
                        <ToolTip text="Shaded" position="bottom" delay={100}>
                            <div
                                onClick={() => setActiveMaterialType('shaded')}
                            >
                                <ToolButton
                                    condition={activeMaterialType === 'shaded'}
                                    icon={
                                        <RespondShadeIcon
                                            color="currentColor"
                                            size={isSmall ? 20 : 32}
                                        />
                                    }
                                />
                            </div>
                        </ToolTip>
                        <ToolTip text="Emissive" position="bottom" delay={100}>
                            <div onClick={() => setActiveMaterialType('glow')}>
                                <ToolButton
                                    condition={activeMaterialType === 'glow'}
                                    icon={
                                        <GlowShadeIcon
                                            color="currentColor"
                                            size={isSmall ? 20 : 32}
                                        />
                                    }
                                />
                            </div>
                        </ToolTip>
                    </div>
                </div>
            )}

            {penActive && openStrokeOptions && (
                <div className="absolute top-[72px] left-[72px] z-5 flex flex-col justify-items-center gap-[4px] rounded-[12px] border-[1px] border-line/25 bg-surface p-[4px] drop-shadow-xl">
                    <ToolTip text="Taper" position="right" delay={100}>
                        <div
                            onClick={() => handleStroke('taper', setStrokeType)}
                        >
                            <ToolButton
                                condition={strokeType === 'taper'}
                                icon={
                                    <TaperStrokeIcon
                                        color={strokeColor}
                                        size={isSmall ? 12 : 20}
                                    />
                                }
                            />
                        </div>
                    </ToolTip>

                    <ToolTip text="Cube" position="right" delay={100}>
                        <div
                            onClick={() => handleStroke('cube', setStrokeType)}
                        >
                            <ToolButton
                                condition={strokeType === 'cube'}
                                icon={
                                    <CubeStrokeIcon
                                        color={strokeColor}
                                        size={isSmall ? 12 : 20}
                                    />
                                }
                            />
                        </div>
                    </ToolTip>

                    <ToolTip text="Paint" position="right" delay={100}>
                        <div
                            onClick={() => handleStroke('paint', setStrokeType)}
                        >
                            <ToolButton
                                condition={strokeType === 'paint'}
                                icon={
                                    <PaintStrokeIcon
                                        color={strokeColor}
                                        size={isSmall ? 12 : 20}
                                    />
                                }
                            />
                        </div>
                    </ToolTip>

                    <ToolTip text="Belt" position="right" delay={100}>
                        <div
                            onClick={() => handleStroke('belt', setStrokeType)}
                        >
                            <ToolButton
                                condition={strokeType === 'belt'}
                                icon={
                                    <BeltStrokeIcon
                                        color={strokeColor}
                                        size={isSmall ? 12 : 20}
                                    />
                                }
                            />
                        </div>
                    </ToolTip>
                </div>
            )}

            {penActive && openDrawShapeOptions && (
                <div className="absolute top-[72px] left-[72px] z-5 flex flex-col justify-items-center gap-[4px] rounded-[12px] border-[1px] border-line/25 bg-surface p-[4px] drop-shadow-xl">
                    <ToolTip text="Free hand" position="right" delay={100}>
                        <div
                            onClick={() =>
                                handleShape('free_hand', setDrawShapeType)
                            }
                        >
                            <ToolButton
                                condition={drawShapeType === 'free_hand'}
                                icon={
                                    <IconScribble
                                        color="currentColor"
                                        size={isSmall ? 12 : 20}
                                        stroke={1.5}
                                    />
                                }
                            />
                        </div>
                    </ToolTip>

                    <ToolTip text="Straight" position="right" delay={100}>
                        <div
                            onClick={() =>
                                handleShape('straight', setDrawShapeType)
                            }
                        >
                            <ToolButton
                                condition={drawShapeType === 'straight'}
                                icon={
                                    <IconLine
                                        color="currentColor"
                                        size={isSmall ? 12 : 20}
                                        stroke={1.5}
                                    />
                                }
                            />
                        </div>
                    </ToolTip>

                    <ToolTip text="Circle" position="right" delay={100}>
                        <div
                            onClick={() =>
                                handleShape('circle', setDrawShapeType)
                            }
                        >
                            <ToolButton
                                condition={drawShapeType === 'circle'}
                                icon={
                                    <IconCircle
                                        color="currentColor"
                                        size={isSmall ? 12 : 20}
                                        stroke={1.5}
                                    />
                                }
                            />
                        </div>
                    </ToolTip>

                    <ToolTip text="Arc" position="right" delay={100}>
                        <div
                            onClick={() => handleShape('arc', setDrawShapeType)}
                        >
                            <ToolButton
                                condition={drawShapeType === 'arc'}
                                icon={
                                    <IconVectorSpline
                                        color="currentColor"
                                        size={isSmall ? 12 : 20}
                                        stroke={1.5}
                                    />
                                }
                            />
                        </div>
                    </ToolTip>
                </div>
            )}

            {penActive && openOpacitySlider && (
                <div className="absolute top-[72px] left-[72px] z-5 w-[140px] rounded-[12px] border-[1px] border-line/25 bg-surface text-ink drop-shadow-xl md:w-[198px]">
                    <RangeSlider
                        name="Stroke Opacity"
                        max={1}
                        min={0.0}
                        step={0.1}
                        value={strokeOpacity}
                        setUpdatingValue={setStrokeOpacity}
                    />
                </div>
            )}

            {penActive && openWidthSlider && (
                <div className="absolute top-[72px] left-[72px] z-5 w-[140px] rounded-[12px] border-[1px] border-line/25 bg-surface text-ink drop-shadow-xl md:w-[198px]">
                    <RangeSlider
                        name="Stroke Width"
                        max={5}
                        min={0}
                        step={0.05}
                        value={strokeWidth}
                        setUpdatingValue={setStrokeWidth}
                    />
                </div>
            )}

            {penActive && openStrokeStabler && (
                <div className="absolute top-[72px] left-[72px] z-5 w-[140px] rounded-[12px] border-[1px] border-line/25 bg-surface text-ink drop-shadow-xl md:w-[198px]">
                    <RangeSlider
                        name="Stroke Stable Percentage"
                        max={100}
                        min={0}
                        step={1}
                        value={strokeStablePercentage}
                        setUpdatingValue={setStrokeStablePercentage}
                    />
                </div>
            )}

            {penActive && mirrorOptions && (
                <div className="absolute top-[72px] left-[72px] z-5 flex flex-col justify-items-center gap-[4px] rounded-[12px] border-[1px] border-line/25 bg-surface p-[4px] drop-shadow-xl">
                    <button
                        onClick={() => handleMirroring('X', mirror, setMirror)}
                        className={`${
                            mirror.x ? 'bg-[#DE3163]/50' : 'hover:bg-surface-3'
                        } cursor-pointer rounded-[8px] border-[0px] p-[8px] font-bold`}
                    >
                        <IconFlipHorizontal
                            color="#DE3163"
                            size={isSmall ? 12 : 20}
                            stroke={1.5}
                        />
                    </button>
                    <button
                        onClick={() => handleMirroring('Y', mirror, setMirror)}
                        className={`${
                            mirror.y ? 'bg-[#50C878]/50' : 'hover:bg-surface-3'
                        } cursor-pointer rounded-[8px] border-[0px] p-[8px] font-bold`}
                    >
                        <IconFlipHorizontal
                            color="#50C878"
                            size={isSmall ? 12 : 20}
                            stroke={1.5}
                        />
                    </button>
                    <button
                        onClick={() => handleMirroring('Z', mirror, setMirror)}
                        className={`${
                            mirror.z ? 'bg-[#0096FF]/50' : 'hover:bg-surface-3'
                        } cursor-pointer rounded-[8px] border-[0px] p-[8px] font-bold`}
                    >
                        <IconFlipHorizontal
                            color="#0096FF"
                            size={isSmall ? 12 : 20}
                            stroke={1.5}
                        />
                    </button>
                </div>
            )}
        </div>
    )
}

export default memo(PenOptionsPanel)
