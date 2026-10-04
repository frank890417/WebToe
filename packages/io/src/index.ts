export { saveProjectFile, loadProjectFile, loadProjectUrl } from './webtoeFile';
export {
  toedirLoader, importFilesFromFileList,
  type ImportFile, type ProjectLoader,
} from './toedir';
export { decodeTdSidecar, isFramedSidecar, type TdSidecar } from './tdContainer';
// `.toe` files reach toedirLoader through the local bridge (one hop, no CLI)
export {
  probeBridge, expandViaBridge, bridgeCandidates, rememberBridge, DEFAULT_BRIDGE_URL,
  type BridgeInfo, type BridgeExpansion,
} from './bridge';
// raw `.toe`/`.tox` decoded natively — research use only (docs/TOE-FORMAT.md)
export {
  decodeToeContainer, isToeContainer, assessToeExpansion, toImportFiles,
  teaDecryptJS, teaDecryptWasm, inflateWeb, TOE_TEA_KEY,
  type ToeDecodeOptions, type ToeDecodeResult, type Inflate, type TeaDecrypt,
} from './toeBinary';
// future: official-JSON ProjectLoader slots in beside toedirLoader (RESEARCH §7)
