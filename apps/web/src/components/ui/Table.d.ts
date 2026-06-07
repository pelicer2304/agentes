import * as React from 'react';
export interface TableProps extends React.HTMLAttributes<HTMLTableElement> {
}
declare function Table({ className, ...props }: TableProps): import("react/jsx-runtime").JSX.Element;
export interface TableHeaderProps extends React.HTMLAttributes<HTMLTableSectionElement> {
}
declare function TableHeader({ className, ...props }: TableHeaderProps): import("react/jsx-runtime").JSX.Element;
export interface TableBodyProps extends React.HTMLAttributes<HTMLTableSectionElement> {
}
declare function TableBody({ className, ...props }: TableBodyProps): import("react/jsx-runtime").JSX.Element;
export interface TableRowProps extends React.HTMLAttributes<HTMLTableRowElement> {
}
declare function TableRow({ className, ...props }: TableRowProps): import("react/jsx-runtime").JSX.Element;
export interface TableHeadProps extends React.ThHTMLAttributes<HTMLTableCellElement> {
}
declare function TableHead({ className, ...props }: TableHeadProps): import("react/jsx-runtime").JSX.Element;
export interface TableCellProps extends React.TdHTMLAttributes<HTMLTableCellElement> {
}
declare function TableCell({ className, ...props }: TableCellProps): import("react/jsx-runtime").JSX.Element;
export { Table, TableHeader, TableBody, TableRow, TableHead, TableCell };
