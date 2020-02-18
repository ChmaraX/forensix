import React from "react";
import { Table, Segment, Header, Placeholder } from "semantic-ui-react";

const PlaceholderRow = () => (
  <Placeholder fluid>
    <Placeholder.Paragraph>
      <Placeholder.Line />
      <Placeholder.Line />
    </Placeholder.Paragraph>
  </Placeholder>
);

function TopSites(props) {
  return (
    <Segment padded raised color="blue">
      <Header as="h1" content="Most visited sites" />
      <Table celled fixed>
        <Table.Header>
          <Table.Row>
            <Table.HeaderCell width={2}>Rank</Table.HeaderCell>
            <Table.HeaderCell>Title</Table.HeaderCell>
            <Table.HeaderCell>URL</Table.HeaderCell>
          </Table.Row>
        </Table.Header>
        <Table.Body>
          {props.topSites?.map(({ url, url_rank, title, redirects }) => (
            <Table.Row active={url_rank === 0} key={url_rank + 1}>
              <Table.Cell>{url_rank + 1}</Table.Cell>
              <Table.Cell>{title}</Table.Cell>
              <Table.Cell>{url}</Table.Cell>
            </Table.Row>
          )) ||
            [...Array(10).keys()].map(() => (
              <Table.Row>
                <Table.Cell>{PlaceholderRow()}</Table.Cell>
                <Table.Cell>{PlaceholderRow()}</Table.Cell>
                <Table.Cell>{PlaceholderRow()}</Table.Cell>
              </Table.Row>
            ))}
        </Table.Body>
      </Table>
    </Segment>
  );
}

export default TopSites;
