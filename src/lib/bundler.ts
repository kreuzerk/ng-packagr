import { NgPackageData } from './model/ng-package-data';
import { NgArtifacts } from './model/ng-artifacts';
import { NgArtifactsFactory } from './model/ng-artifacts-factory';
import { writePackage } from './steps/package';
import { processAssets } from './steps/assets';
import { ngc, prepareTsConfig, collectTemplateAndStylesheetFiles, inlineTemplatesAndStyles } from './steps/ngc';
import { minifyJsFile } from './steps/uglify';
import { remapSourceMap } from './steps/sorcery';
import { rollup } from './steps/rollup';
import { downlevelWithTsc } from './steps/tsc';
import { copySourceFilesToDestination } from './steps/transfer';
import { rimraf } from './util/rimraf';
import * as log from './util/log';

/**
 * Transforms TypeScript source files to Angular Package Format.
 *
 * @param ngPkg Parent Angular package.
 */
export async function transformSources(ngPkg: NgPackageData): Promise<void> {

  log.info(`Building from sources for entry point '${ngPkg.fullPackageName}'`);

  // TODO: remove such enterprisy factory classes
  const artifactFactory: NgArtifactsFactory = new NgArtifactsFactory();
  // TODO: correct speller to "artefact" instead of us-american "artifacts"
  const artifacts: NgArtifacts = artifactFactory.calculateArtifactPathsForBuild(ngPkg);
  artifacts.temp = {};
  // TODO: this path must be resolved properly
  artifacts.temp.stageDir = `${ngPkg.buildDirectory}/${ngPkg.pathOffsetFromSourceRoot}`;

  // 0. CLEAN BUILD DIRECTORY
  log.info('Cleaning build directory');
  await rimraf(ngPkg.buildDirectory);

  // 0. TWO-PASS TSC TRANSFORMATION
  artifacts.extras = {};
  artifacts.extras.tsConfig = prepareTsConfig(ngPkg);

  // First pass: collect templateUrl and stylesUrl referencing source files.
  log.info('Extracting templateUrl and stylesUrl');
  let result = collectTemplateAndStylesheetFiles(artifacts.extras.tsConfig, artifacts);
  result.dispose();

  // Then, process assets keeping transformed contents in memory.
  log.info('Processing assets');
  await processAssets(artifacts);

  // Second pass: inline templateUrl and stylesUrl
  log.info('Inlining templateUrl and stylesUrl');
  result = inlineTemplatesAndStyles(artifacts.extras.tsConfig, artifacts);
  artifacts.temp.tsSourceFiles = result;

  // 1. NGC
  log.info('Compiling with ngc');
  const es2015EntryFile: string = await ngc(ngPkg, artifacts, artifacts.extras.tsConfig);
  result.dispose();

  // 3. FESM15: ROLLUP
  log.info('Bundling to FESM15');
  await rollup({
    moduleName: ngPkg.moduleName,
    entry: es2015EntryFile,
    format: 'es',
    dest: artifacts.es2015,
    externals: ngPkg.libExternals
  });
  await remapSourceMap(artifacts.es2015);

  // 4. FESM5: TSC
  log.info('Bundling to FESM5');
  await downlevelWithTsc(
    artifacts.es2015,
    artifacts.module);
  await remapSourceMap(artifacts.module);

  // 5. UMD: ROLLUP
  log.info('Bundling to UMD');
  await rollup({
    moduleName: ngPkg.moduleName,
    entry: artifacts.module,
    format: 'umd',
    dest: artifacts.main,
    externals: ngPkg.libExternals
  });
  await remapSourceMap(artifacts.main);

  // 6. UMD: Minify
  log.info('Minifying UMD bundle');
  const minifiedFilePath: string = await minifyJsFile(artifacts.main);
  await remapSourceMap(minifiedFilePath);

  // 8. COPY SOURCE FILES TO DESTINATION
  log.info('Copying staged files');
  await copySourceFilesToDestination(ngPkg, artifacts.temp.stageDir);

  // 9. WRITE PACKAGE.JSON and OTHER DOC FILES
  log.info('Writing package metadata');
  const packageJsonArtifactPaths: NgArtifacts = artifactFactory.calculateArtifactPathsForPackageJson(ngPkg);
  await writePackage(ngPkg, packageJsonArtifactPaths);

  log.success(`Built ${ngPkg.fullPackageName}`);
}
