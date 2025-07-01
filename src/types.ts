export interface Source {
  id: string;
  name: string;
  code: string;
}

export interface Transform {
  id: string;
  parser?: string;
  sources: Source[];
  deploymentId: string;
  transformId: string;
}

export type ActionIds =
  | "install-dependency"
  | "remove-dependency"
  | "upgrade-dependency"
  | "file-delete"
  | "file-create"
  | "file-move"
  | "folder-create"
  | "folder-move"
  | "folder-delete";

export type ActionArguments =
  | "dependency-name"
  | "destination-path"
  | "file-content"
  | "file-path"
  | "folder-path"
  | "source-path"
  | "version";

export interface Action {
  name: ActionIds;
}

export interface Argument {
  key: ActionArguments;
  value: string;
}

export interface TransformOnDeployment {
  deploymentId: string;
  transformId?: string;
  transform?: Transform;
  actionId?: string;
  action?: Action;
  type: "TRANSFORM" | "ACTION";
  arguments: Argument[];
}

export interface Deployment {
  id: string;
  title: string;
  description: string;
  transforms: TransformOnDeployment[];
}
