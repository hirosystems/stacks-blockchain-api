declare module 'getopts' {
  interface ParsedOptions {
    _: string[];
    [key: string]: any;
  }

  interface Options {
    alias?: { [key: string]: string | string[] };
    string?: string[];
    boolean?: string[];
    default?: { [key: string]: any };
    unknown?: (optionName: string) => boolean;
    stopEarly?: boolean;
  }

  export default function getopts(argv: string[], options?: Options): ParsedOptions;
}
