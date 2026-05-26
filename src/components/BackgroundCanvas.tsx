import { Shader, FlowingGradient, Aurora, Plasma } from 'shaders/react';

type Props = {
  shaderType: string;
  shaderColors: string[];
};

const shaderComponents: Record<string, React.ComponentType<any>> = {
  'flowing-gradient': FlowingGradient,
  'aurora': Aurora,
  'plasma': Plasma,
};

export function BackgroundCanvas({ shaderType, shaderColors }: Props): JSX.Element {
  const Comp = shaderComponents[shaderType] ?? FlowingGradient;
  const props: Record<string, any> = {};
  shaderColors.forEach((color, i) => {
    props[`color${String.fromCharCode(65 + i)}`] = color;
  });

  return (
    <>
      <div className="bg-canvas-shader">
        <Shader className="bg-canvas-shader-inner">
          <Comp {...props} />
        </Shader>
      </div>
      <div className="grid-overlay" />
    </>
  );
}
