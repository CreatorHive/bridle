// The file viewer side panel. Mount <FileViewer /> inside .panel after <main className="content">;
// open files from anywhere with viewer.open(absolutePath) (or viewer.openWorkspacePath("notes/x.md")).
export { FileViewer } from './FileViewer'
export { useViewer, viewer } from './store'
