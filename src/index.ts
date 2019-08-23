import path from 'path';
import ObjectStream, { EnteredArgs } from 'o-stream';

import File = require('vinyl');

export interface FileData {
  path: string;
  index: number;
  import: string;
}

export interface TSConfig {
  compilerOptions: CompilerOptions;
}

export interface CompilerOptions {
  baseUrl?: string;
  paths: { [key: string]: string[] | undefined; };
}

export interface PluginOptions {
  configuration: TSConfig | CompilerOptions;
}

export type AliasPlugin = (pluginOptions: PluginOptions) => any;

function parseImports(file: ReadonlyArray<string>, dir: string): FileData[] {
  const results = file.map((line: string, index: number) => {
    const imports = findImport(line);

    if (imports === null) {
      return null;
    }

    return {
      path: dir,
      index,
      import: imports,
    };
  });

  return results.filter((value: { path: string; index: number; import: string; } | null): value is FileData => {
    return value !== null && value !== undefined;
  });
}

function findImport(line: string): string | null {
  const matches = line.match(/from (["'])(.*?)\1/) || line.match(/import\((["'])(.*?)\1\)/) || line.match(/require\((["'])(.*?)\1\)/);

  if (!matches) {
    return null;
  }

  const multiple = [/from (["'])(.*?)\1/g, /import\((["'])(.*?)\1\)/g, /require\((["'])(.*?)\1\)/g].some((exp) => {
    const results = line.match(exp);

    return results && results.length > 1;
  })

  if (multiple) {
    throw new Error('Multiple imports on the same line are currently not supported!');
  }

  return matches[2];
}

function resolveImports(file: ReadonlyArray<string>, imports: FileData[], options: CompilerOptions): string[] {
  const { baseUrl, paths } = options;

  const aliases: { [key: string]: string[] | undefined } = {};
  for (const alias in paths) {
    /* istanbul ignore else  */
    if (paths.hasOwnProperty(alias)) {
      let resolved = alias;
      if (alias.endsWith('/*')) {
        resolved = alias.replace('/*', '/');
      }

      aliases[resolved] = paths[alias];
    }
  }

  const lines: string[] = [...file];
  for (const imported of imports) {
    const line = file[imported.index];

    let resolved: string = '';
    for (const alias in aliases) {
      /* istanbul ignore else  */
      if (aliases.hasOwnProperty(alias) && imported.import.startsWith(alias)) {
        const choices: string[] | undefined = aliases[alias];

        if (choices != undefined) {
          resolved = choices[0];
          if (resolved.endsWith('/*')) {
            resolved = resolved.replace('/*', '/');
          }

          resolved = imported.import.replace(alias, resolved);

          break;
        }
      }
    }

    if (resolved.length < 1) {
      continue;
    }

    let relative = path.relative(path.dirname(imported.path), baseUrl || './');
    relative = path.join(relative, resolved);
    relative = path.relative(path.dirname(imported.path), path.resolve(path.dirname(imported.path), relative));
    relative = relative.replace(/\\/g, '/');

    if (relative.length === 0 || !relative.startsWith('.')) {
      relative = './' + relative;
    }

    lines[imported.index] = line.replace(imported.import, relative);
  }

  return lines;
}

const aliasPlugin: AliasPlugin = (pluginOptions: PluginOptions) => {
  if (pluginOptions.configuration === undefined || pluginOptions.configuration === null) {
    // tslint:disable-next-line:max-line-length
    throw new Error('The \"configuration\" option cannot be empty. Provide the tsconfig or compilerOptions object.');
  }

  // tslint:disable-next-line:max-line-length
  const compilerOptions: CompilerOptions = (pluginOptions.configuration as TSConfig).compilerOptions || pluginOptions.configuration as CompilerOptions;

  if (compilerOptions.paths === undefined || compilerOptions.paths === null) {
    throw new Error('Unable to find the \"paths\" property in the supplied configuration!');
  }

  if (compilerOptions.baseUrl === undefined || compilerOptions.baseUrl === '.') {
    compilerOptions.baseUrl = './';
  }

  return ObjectStream.transform({
    onEntered: (args: EnteredArgs<File, File>) => {
      const file = args.object;

      if (file.isStream()) {
        throw new Error('Streaming is not supported.');
      }

      if (file.isNull() || !file.contents) {
        args.output.push(file);
        return;
      }

      if (!file.path) {
        throw new Error('Received file with no path. Files must have path to be resolved.');
      }

      const lines = file.contents.toString().split('\n');
      const imports = parseImports(lines, file.path);

      if (imports.length === 0) {
        args.output.push(file);

        return;
      }

      const resolved = resolveImports(lines, imports, compilerOptions);

      file.contents = Buffer.from(resolved.join('\n'));

      args.output.push(file);
    }
  })
};

export default aliasPlugin;

// ES5/ES6 fallbacks
module.exports = aliasPlugin;
module.exports.default = aliasPlugin;
