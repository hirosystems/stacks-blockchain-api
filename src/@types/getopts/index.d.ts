declare module 'getopts' {
  interface ParsedOptions {
    _: string[];
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    [key: string]: any;
  }

  interface Options {
    alias?: { [key: string]: string | string[] };
    string?: string[];
    boolean?: string[];
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    default?: { [key: string]: any };
    unknown?: (optionName: string) => boolean;
    stopEarly?: boolean;
  }

  export default function getopts(argv: string[], options?: Options): ParsedOptions;
}
