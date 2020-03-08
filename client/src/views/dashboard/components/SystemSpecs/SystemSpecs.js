import React from "react";
import { Segment, Statistic, Icon } from "semantic-ui-react";

function SystemSpecs(props) {

  return (
    <React.Fragment>
      <Segment raised style={{ textAlign: "center" }} color="blue">
        <Statistic size="tiny" horizontal color="blue">
          <Statistic.Value>
            {props.systemSpecs?.chromeVersion || "Unknown"}
          </Statistic.Value>
          <Statistic.Label>Chrome Version</Statistic.Label>
        </Statistic>
      </Segment>
      <Segment raised color="blue">
        <Statistic.Group size="mini" widths={2} color="blue">
          <Statistic>
            <Statistic.Value>
              <Icon name={props.systemSpecs?.os} />{" "}
              {props.systemSpecs?.os || "Unknown"}
            </Statistic.Value>
            <Statistic.Label>operating system</Statistic.Label>
          </Statistic>
          <Statistic>
            <Statistic.Value>
              {props.systemSpecs?.resolution.bottom}
              <small>x</small>
              {props.systemSpecs?.resolution.right}
            </Statistic.Value>
            <Statistic.Label>resolution</Statistic.Label>
          </Statistic>
        </Statistic.Group>
      </Segment>
      <Segment raised style={{ textAlign: "center" }} color="blue">
        <Statistic size="tiny" color="blue">
          <Statistic.Value>
            {props.systemSpecs?.mobileDevices.length > 0
              ? props.systemSpecs.mobileDevices.map(device => {
                  return (
                    <span>
                      <Icon name={device} /> {device}{" "}
                    </span>
                  );
                })
              : "Unknown"}
          </Statistic.Value>
          <Statistic.Label>mobile devices</Statistic.Label>
        </Statistic>
      </Segment>
    </React.Fragment>
  );
}

export default SystemSpecs;
