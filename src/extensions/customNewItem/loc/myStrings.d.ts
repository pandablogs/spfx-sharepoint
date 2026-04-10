declare interface ICustomNewItemCommandSetStrings {
  Command1: string;
  Command2: string;
}

declare module 'CustomNewItemCommandSetStrings' {
  const strings: ICustomNewItemCommandSetStrings;
  export = strings;
}
