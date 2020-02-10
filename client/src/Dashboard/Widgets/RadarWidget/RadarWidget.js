import React from "react";
import {
  RadarChart,
  PolarGrid,
  PolarAngleAxis,
  PolarRadiusAxis,
  Radar,
  ResponsiveContainer
} from "recharts";
import { Segment, Header, List, Placeholder } from "semantic-ui-react";
import _ from "lodash";

const transformData = data => {
  let transformedData = [
    {
      category: "Business",
      count: 0,
      fullMark: data.length
    },
    {
      category: "Arts",
      count: 0,
      fullMark: data.length
    },
    {
      category: "Computers",
      count: 0,
      fullMark: data.length
    },
    {
      category: "Reference",
      count: 0,
      fullMark: data.length
    },
    {
      category: "Society",
      count: 0,
      fullMark: data.length
    },
    {
      category: "Kids",
      count: 0,
      fullMark: data.length
    },
    {
      category: "Health",
      count: 0,
      fullMark: data.length
    },
    {
      category: "Science",
      count: 0,
      fullMark: data.length
    }
  ];

  data.forEach(el => {
    switch (el.category) {
      case "Business":
        transformedData[0].count += 1;
        break;
      case "Arts":
        transformedData[1].count += 1;
        break;
      case "Computers":
        transformedData[2].count += 1;
        break;
      case "Reference":
        transformedData[3].count += 1;
        break;
      case "Society":
        transformedData[4].count += 1;
        break;
      case "Kids":
        transformedData[5].count += 1;
        break;
      case "Health":
        transformedData[6].count += 1;
        break;
      case "Science":
        transformedData[7].count += 1;
        break;
    }
  });

  let max = _.maxBy(transformedData, e => {
    return e.count;
  }).count;

  transformedData.forEach(el => {
    el.fullMark = max;
  });

  return transformedData;
};

const PlaceholderImage = () => (
  <Placeholder
    style={{ height: "inherit", width: "300px", marginLeft: "40px" }}
  >
    <Placeholder.Image />
  </Placeholder>
);

function RadarWidget(props) {
  return (
    <Segment
      raised
      style={{ display: "flex", justifyContent: "space-between" }}
      color="blue"
    >
      <React.Fragment>
        <div>
          <Header
            as="h1"
            content="Classified URLs"
            style={{ display: "inline-block" }}
          />
          <List>
            {_.orderBy(
              transformData(props.classified || []),
              ["count"],
              ["desc"]
            ).map((c, i) => {
              return (
                <List.Item>
                  <b>{i + 1}.</b> {c.category} - {c.count}
                </List.Item>
              );
            })}
          </List>
        </div>
        <ResponsiveContainer width={340}>
          {props.classified ? (
            <RadarChart
              outerRadius={90}
              data={transformData(props.classified || []).filter(
                el => el.count >= 10
              )}
            >
              <PolarGrid />
              <PolarAngleAxis dataKey="category" />
              <PolarRadiusAxis angle={30} />
              <Radar
                name="URL"
                dataKey="count"
                stroke="#82ca9d"
                fill="#82ca9d"
                fillOpacity={0.6}
              />
            </RadarChart>
          ) : (
            PlaceholderImage()
          )}
        </ResponsiveContainer>
      </React.Fragment>
    </Segment>
  );
}

export default RadarWidget;
