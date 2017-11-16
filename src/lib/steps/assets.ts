import * as path from 'path';
import { debug, warn } from '../util/log';
import { readFile } from 'fs-extra';

// CSS Tools
import * as autoprefixer from 'autoprefixer';
import * as browserslist from 'browserslist';
import * as postcss from 'postcss';
import * as sass from 'node-sass';
import * as less from 'less';
import * as stylus from 'stylus';
import { NgArtifacts } from '../model/ng-artifacts';

export const processAssets =
  async (artefacts: NgArtifacts): Promise<NgArtifacts> => {
    // process templates
    const templates = await Promise.all(
      Object.keys(artefacts.temp.templates)
        .map(async (template) => {
          return {
            name: template,
            content: await processTemplate(template)
          };
        })
    );
    templates.forEach((template) => {
      artefacts.temp.templates[template.name] = template.content;
    });

    // process stylesheets

    return Promise.resolve(artefacts);
  }

/**
 * Process a component's template.
 *
 * @param templateFile Path of the HTML templatefile, e.g. `/Users/foo/Project/bar/bar.component.html`
 * @return Resolved content of HTML template file
 */
const processTemplate =
  (componentFile: string): Promise<string> =>
    readFile(componentFile).then((buffer) => buffer.toString());

/**
 *
 * @param src Source folder
 * @param path Path of ... what?!?
 * @param ext
 * @param file
 */
const processStyles = async (src: string, path, ext, file): Promise<string> => {

  try {
    debug(`render stylesheet ${path}`);
    const css: string = await pickRenderer(path, file, src);

    debug(`postcss with autoprefixer for ${path}`);
    const browsers = browserslist(undefined, { path });
    const result: postcss.Result = await postcss([ autoprefixer({ browsers }) ])
      .process(css, { from: path, to: path.replace(ext, '.css') });
    // Log warnings from postcss
    result.warnings().forEach((msg) => {
      warn(msg.toString());
    });

    return Promise.resolve(result.css);
  } catch (err) {
    return Promise.reject(new Error(`Cannot inline stylesheet ${path}`));
  }
}


async function pickRenderer(
  filePath: string,
  file: string,
  srcPath: string): Promise<string> {

  switch (path.extname(filePath)) {

    case '.scss':
    case '.sass':
      debug(`rendering sass for ${filePath}`);
      return await renderSass({ file: filePath, importer: sassImporter });

    case '.less':
      debug(`rendering less for ${filePath}`);
      return await renderLess({ filename: filePath });

    case '.styl':
    case '.stylus':
      debug(`rendering styl for ${filePath}`);
      return await renderStylus({ filename: filePath, root: srcPath });

    case '.css':
    default:
      return file;
  }

}

const sassImporter = (url: string): any => {
  if (url[0] === '~') {
    url = path.resolve('node_modules', url.substr(1));
  }

  return { file: url };
}

const renderSass = (sassOpts: any): Promise<string> => {

  return new Promise((resolve, reject) => {

    sass.render(sassOpts, (err, result) => {
      if (err) {
        reject(err);
      } else {
        resolve(result.css.toString());
      }
    });
  });
}

const renderLess = (lessOpts: any): Promise<string> => {

  return readFile(lessOpts.filename)
    .then(buffer => buffer.toString())
    .then((lessData: string) => new Promise<string>((resolve, reject) => {
        less.render(lessData || '', lessOpts, (err, result) => {
        if (err) {
          reject(err);
        } else {
          resolve(result.css.toString());
        }
      })
    }));
}

/**
 * filename - absolute path to file
 * root - root folder of project (where ng-package.json is located)
 */
const renderStylus = ({ filename, root }): Promise<string> => {
  return readFile(filename)
    .then(buffer => buffer.toString())
    .then((stylusData: string) => new Promise<string>((resolve, reject) => {
      stylus(stylusData)
        // add paths for resolve
        .include(root)
        .include('.')
        // add support for resolving plugins from node_modules
        .include('node_modules')
        .set('filename', filename)
        // turn on url resolver in stylus, same as flag --resolve-url
        .set('resolve url', true)
        .define('url', stylus.resolver())
        .render((err, css) => {
          if (err) {
            reject(err);
          } else {
            resolve(css);
          }
        });
      }));
}
