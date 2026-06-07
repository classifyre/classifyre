declare module "react-cytoscapejs" {
  import type { Core, ElementDefinition, Stylesheet } from "cytoscape";
  import type { CSSProperties, ComponentType } from "react";

  export interface CytoscapeComponentProps {
    elements: ElementDefinition[];
    style?: CSSProperties;
    className?: string;
    stylesheet?: Stylesheet[] | Stylesheet;
    layout?: Record<string, unknown>;
    cy?: (cy: Core) => void;
    minZoom?: number;
    maxZoom?: number;
    wheelSensitivity?: number;
  }

  const CytoscapeComponent: ComponentType<CytoscapeComponentProps> & {
    normalizeElements: (data: unknown) => ElementDefinition[];
  };
  export default CytoscapeComponent;
}

declare module "cytoscape-cola" {
  import type cytoscape from "cytoscape";
  const ext: cytoscape.Ext;
  export default ext;
}

declare module "cytoscape-dagre" {
  import type cytoscape from "cytoscape";
  const ext: cytoscape.Ext;
  export default ext;
}
