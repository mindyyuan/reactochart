import _ from "lodash";
import { scalePoint } from "d3";
import React from "react";
import invariant from "invariant";

import {
  makeAccessor,
  makeAccessor2,
  getValue,
  domainFromDatasets,
  domainFromData,
  inferDatasetsType,
  datasetsFromPropsOrDescendants,
  combineDomains,
  combineBorderObjects,
  isValidDomain
} from "./Data";

import {
  scaleTypeFromDataType,
  dataTypeFromScaleType,
  inferDataTypeFromDomain,
  initScale,
  isValidScale
} from "./Scale";

import { innerRangeX, innerRangeY, innerWidth, innerHeight } from "./Margin";

/**
 * `resolveXYScales` is a higher-order-component.
 *
 * @param {Component} Component - The React Component (class) which should be wrapped by this HOC
 * @returns {Component} - A Component which auto-resolves XY scales from given props
 */

const errs = {
  getDomain: C =>
    `Components enhanced by resolveXYScales must have a static getDomain method, ${componentName(
      C
    )} does not have one`
};
function componentName(Component) {
  return Component.displayName || "Component wrapped by resolveXYScales";
}

function isValidScaleType(scaleType) {
  const validScaleTypes = ["ordinal", "time", "log", "pow", "linear"];

  return _.includes(validScaleTypes, scaleType);
}
function areValidScales(scales) {
  return _.every(scales, isValidScale);
}
function areValidScaleTypes(scaleTypes) {
  return _.every(scaleTypes, isValidScaleType);
}

function mapOverChildren(children, iteratee, ...iterateeArgs) {
  // loop over all children (react elements) and call iteratee (a function) on each one
  // iteratee is called with parameters (child.props, child.type, ...iterateeArgs)
  if (!_.isFunction(iteratee))
    throw new Error("mapOverChildren iteratee must be a function");

  return _.compact(
    React.Children.map(children, child => {
      if (!child || !React.isValidElement(child)) return null;
      return iteratee(child.props, child.type, ...iterateeArgs);
    })
  );
}
function omitNullUndefined(obj) {
  return _.omitBy(obj, v => _.isUndefined(v) || _.isNull(v));
}

// not currently being used but potentially has some learnings
// attempt at condensing all the resolve functions below
// function resolveXYPropsOnComponentOrChildren(propKeys, props, reducers = {}, validators = {}, result = {}) {
//   const isDone = (o) => (_.every(propKeys, k => _.isObject(o[k]) && _.every(['x', 'y'], xy => _.has(o[k][xy]))));
//   result = _.pick({...props, ...result}, propKeys);

//   let resolved = {};
//   _.forEach(propKeys, propKey => {
//     _.forEach(['x', 'y'], k => {
//       const isValid = validators[propKey] || (() => true);
//       if(_.isObject(props[propKey]) && _.has(props[propKey], k) && isValid(props[propKey][k])) {
//         if(!_.has(result, propKey)) result[propKey] = {};
//         result[propKey][k] = props[propKey][k];
//       }
//     });
//   });

//   if(isDone(result)) return result;

//   if(React.Children.count(props.children)) {
//     let childProps = mapOverChildren(props.children, resolveXYPropsOnComponentOrChildren, propKeys, 'props', result);
//     React.Children.forEach(props.children, child => {
//       if(!child) return;
//       childProps.push(resolveXYPropsOnComponentOrChildren(propKeys, child.props, result));
//     });
//       let childDomains = [];
//       React.Children.forEach(props.children, child => {
//         childDomains = childDomains.concat(this._resolveDomain(child.props, child.type, scaleType));
//       });

//       console.log('combining domains', childDomains);
//       const childDomain =  _.fromPairs(['x', 'y'].map(k => {
//         console.log(_.compact(_.map(childDomains, k)), scaleType[k]);
//         const kDomain = combineDomains(_.compact(_.map(childDomains, k)), dataTypeFromScaleType(scaleType[k]));
//         console.log(kDomain);
//         return [k, kDomain];
//       }));
//       console.log('combined domains', childDomain);

//       domain = _.assign(childDomain, domain);
//       return domain;
//   }

//   propKeys.forEach(k => {
//     result[propKeys] = props
//   })
// }

export default function resolveXYScales(ComposedComponent) {
  return class extends React.Component {
    // todo better way for HOC's to pass statics through?
    static getScaleType = ComposedComponent.getScaleType;
    static getSpacing = ComposedComponent.getSpacing;
    static getDomain = ComposedComponent.getDomain;
    static getMargin = ComposedComponent.getMargin;
    static defaultProps = ComposedComponent.defaultProps;

    _resolveScaleType(props, Component) {
      let { xScaleType, yScaleType } = props;

      const isDone = () => areValidScaleTypes([xScaleType, yScaleType]);

      // short-circuit if both scale types provided
      if (isDone()) return { xScaleType, yScaleType };

      // if Component provides a custom static getScaleType method
      // use it to determine remaining scale types
      if (_.isFunction(Component.getScaleType)) {
        const componentScaleTypes = omitNullUndefined(
          Component.getScaleType(props)
        );
        ({ xScaleType, yScaleType } = _.assign(
          componentScaleTypes,
          omitNullUndefined({ xScaleType, yScaleType })
        ));
        if (isDone()) return { xScaleType, yScaleType };
      }

      // if component has domain props,
      // infer the data type, & use that to get scale type
      if (!isValidScaleType(xScaleType) && isValidDomain(props.xDomain)) {
        xScaleType = scaleTypeFromDataType(
          inferDataTypeFromDomain(props.xDomain)
        );
      }
      if (!isValidScaleType(yScaleType) && isValidDomain(props.yDomain)) {
        yScaleType = scaleTypeFromDataType(
          inferDataTypeFromDomain(props.yDomain)
        );
      }
      if (isDone()) return { xScaleType, yScaleType };

      // if Component has data or datasets props,
      // infer the data type, & use that to get scale type
      if (_.isArray(props.data) || _.isArray(props.datasets)) {
        const datasets = _.isArray(props.datasets)
          ? props.datasets
          : [props.data];

        if (!isValidScaleType(xScaleType)) {
          xScaleType = scaleTypeFromDataType(
            inferDatasetsType(datasets, makeAccessor2(props.x))
          );
        }
        if (!isValidScaleType(yScaleType)) {
          yScaleType = scaleTypeFromDataType(
            inferDatasetsType(datasets, makeAccessor2(props.y))
          );
        }
        if (isDone()) return { xScaleType, yScaleType };
      }

      // if Component has children,
      // recurse through descendants to resolve their scale types the same way
      if (React.Children.count(props.children)) {
        let childrenScaleTypes = mapOverChildren(
          props.children,
          this._resolveScaleType.bind(this)
        );

        if (!isValidScaleType(xScaleType)) {
          const childXScaleTypes = _.compact(
            _.uniq(
              childrenScaleTypes.map(
                childScaleTypes => childScaleTypes.xScaleType
              )
            )
          );
          if (!childXScaleTypes.length === 1)
            console.warn(
              "Multiple children with different X scale types found - defaulting to 'ordinal'"
            );
          xScaleType =
            childXScaleTypes.length === 1 ? childXScaleTypes[0] : "ordinal";
        }
        if (!isValidScaleType(yScaleType)) {
          const childYScaleTypes = _.compact(
            _.uniq(
              childrenScaleTypes.map(
                childScaleTypes => childScaleTypes.yScaleType
              )
            )
          );
          if (!childYScaleTypes.length === 1)
            console.warn(
              "Multiple children with different Y scale types found - defaulting to 'ordinal'"
            );
          yScaleType =
            childYScaleTypes.length === 1 ? childYScaleTypes[0] : "ordinal";
        }
      }

      // if(!isDone()) console.warn(`resolveXYScales was unable to resolve both scale types. xScaleType: ${xScaleType}, yScaleType: ${yScaleType}`);

      return { xScaleType, yScaleType };
    }

    _resolveDomain(props, Component, xScaleType, yScaleType) {
      let { xDomain, yDomain, includeXZero, includeYZero } = props;
      const xDataType = dataTypeFromScaleType(xScaleType);
      const yDataType = dataTypeFromScaleType(yScaleType);

      const isXDone = () => isValidDomain(xDomain, xDataType);
      const isYDone = () => isValidDomain(yDomain, yDataType);
      const isDone = () => isXDone() && isYDone();

      // short-circuit if all domains provided
      if (isDone()) return { xDomain, yDomain };

      // if Component provides a custom static getScaleType method
      // use it to determine remaining scale types
      if (_.isFunction(Component.getDomain)) {
        const {
          xDomain: componentXDomain,
          yDomain: componentYDomain
        } = Component.getDomain({ ...props, xScaleType, yScaleType });

        if (
          !isXDone() &&
          componentXDomain &&
          !isValidDomain(componentXDomain, xDataType)
        )
          console.warn(
            `Component.getDomain returned an invalid domain for data type '${xDataType}': ${componentXDomain} - ignoring`
          );
        if (!isXDone() && isValidDomain(componentXDomain, xDataType))
          xDomain = componentXDomain;

        if (
          !isYDone() &&
          componentYDomain &&
          !isValidDomain(componentYDomain, yDataType)
        )
          console.warn(
            `Component.getDomain returned an invalid domain for data type '${yDataType}': ${componentYDomain} - ignoring`
          );
        if (!isYDone() && isValidDomain(componentYDomain, yDataType))
          yDomain = componentYDomain;
      }

      // if Component has data or datasets props,
      // use the default domainFromDatasets function to determine a domain from them
      if (!isDone() && (_.isArray(props.data) || _.isArray(props.datasets))) {
        const datasets = _.isArray(props.datasets)
          ? props.datasets
          : [props.data];
        if (!isXDone()) {
          xDomain = domainFromDatasets(
            datasets,
            makeAccessor2(props.x),
            xDataType
          );
        }
        if (!isYDone()) {
          yDomain = domainFromDatasets(
            datasets,
            makeAccessor2(props.y),
            yDataType
          );
        }
      }

      // if Component has children,
      // recurse through descendants to resolve their domains the same way,
      // and combine them into a single domain, if there are multiple
      if (!isDone() && React.Children.count(props.children)) {
        let childrenDomains = mapOverChildren(
          props.children,
          this._resolveDomain.bind(this),
          xScaleType,
          yScaleType
        );

        if (!isXDone()) {
          const childXDomains = _.compact(
            childrenDomains.map(childDomains => childDomains.xDomain)
          );
          xDomain = combineDomains(childXDomains, xDataType);
        }
        if (!isYDone()) {
          const childYDomains = _.compact(
            childrenDomains.map(childDomains => childDomains.yDomain)
          );
          yDomain = combineDomains(childYDomains, yDataType);
        }
      }

      if (isDone()) {
        if (includeXZero && !_.inRange(0, ...xDomain)) {
          // If both are negative set max of domain to 0
          if (xDomain[0] < 0 && xDomain[1] < 0) {
            xDomain[1] = 0;
          } else {
            xDomain[0] = 0;
          }
        }

        if (includeYZero && !_.inRange(0, ...yDomain)) {
          // If both are negative set max of domain to 0
          if (yDomain[0] < 0 && yDomain[1] < 0) {
            yDomain[1] = 0;
          } else {
            yDomain[0] = 0;
          }
        }
      }

      // TODO handle resolveXYScales not calculating the domain
      // Because this is recursive on its children it will log this warn for children missing domain
      // even though it is later inferred by parent later during the recursion
      // if (!isDone()) {
      //   console.warn(`resolveXYScales was unable to resolve both domains. xDomain: ${xDomain}, yDomain: ${yDomain}`);
      // }

      return { xDomain, yDomain };
    }

    _resolveTickDomain(
      props,
      Component,
      { xScaleType, yScaleType, xDomain, yDomain, xScale, yScale }
    ) {
      if (_.isFunction(Component.getTickDomain)) {
        const componentTickDomains = Component.getTickDomain({
          xScaleType,
          yScaleType,
          xDomain,
          yDomain,
          xScale,
          yScale,
          ...props
        });
        return omitNullUndefined(componentTickDomains);
      }

      if (React.Children.count(props.children)) {
        let childrenTickDomains = mapOverChildren(
          props.children,
          this._resolveTickDomain.bind(this),
          { xScaleType, yScaleType, xDomain, yDomain, xScale, yScale }
        );

        const childrenXTickDomains = _.compact(
          childrenTickDomains.map(
            childTickDomains => childTickDomains.xTickDomain
          )
        );
        const xTickDomain = childrenXTickDomains.length
          ? combineDomains(
              childrenXTickDomains,
              dataTypeFromScaleType(xScaleType)
            )
          : undefined;

        const childrenYTickDomains = _.compact(
          childrenTickDomains.map(
            childTickDomains => childTickDomains.yTickDomain
          )
        );
        const yTickDomain = childrenYTickDomains.length
          ? combineDomains(
              childrenYTickDomains,
              dataTypeFromScaleType(yScaleType)
            )
          : undefined;

        return omitNullUndefined({ xTickDomain, yTickDomain });
      }

      return {};
    }

    _resolveMargin(
      props,
      Component,
      { xScaleType, yScaleType, xDomain, yDomain, xScale, yScale }
    ) {
      let { marginTop, marginBottom, marginLeft, marginRight } = props;

      const isDone = () =>
        _.every([marginTop, marginBottom, marginLeft, marginRight], _.isNumber);

      // short-circuit if all margins provided
      if (isDone()) return { marginTop, marginBottom, marginLeft, marginRight };

      // if Component provides a custom static getMargin method
      // use it to determine remaining domains
      if (_.isFunction(Component.getMargin)) {
        const componentMargin = omitNullUndefined(
          Component.getMargin({
            ...props,
            xScaleType,
            yScaleType,
            xDomain,
            yDomain,
            xScale,
            yScale
          })
        );
        ({ marginTop, marginBottom, marginLeft, marginRight } = _.assign(
          componentMargin,
          omitNullUndefined({
            marginTop,
            marginBottom,
            marginLeft,
            marginRight
          })
        ));
        if (isDone())
          return { marginTop, marginBottom, marginLeft, marginRight };
      }

      // if Component has children,
      // recurse through descendants to resolve their margins the same way,
      // and combine them into a single margin, if there are multiple
      if (React.Children.count(props.children)) {
        let childrenMargins = mapOverChildren(
          props.children,
          this._resolveMargin.bind(this),
          { xScaleType, yScaleType, xDomain, yDomain, xScale, yScale }
        );

        // console.log('combining child margins', childMargins);
        const childrenMargin = combineBorderObjects(
          childrenMargins.map(childMargins => ({
            top: childMargins.marginTop,
            bottom: childMargins.marginBottom,
            left: childMargins.marginLeft,
            right: childMargins.marginRight
          }))
        );

        marginTop = _.isUndefined(marginTop) ? childrenMargin.top : marginTop;
        marginBottom = _.isUndefined(marginBottom)
          ? childrenMargin.bottom
          : marginBottom;
        marginLeft = _.isUndefined(marginLeft)
          ? childrenMargin.left
          : marginLeft;
        marginRight = _.isUndefined(marginRight)
          ? childrenMargin.right
          : marginRight;
      }

      return { marginTop, marginBottom, marginLeft, marginRight };
    }

    _resolveSpacing(
      props,
      Component,
      { xScaleType, yScaleType, xDomain, yDomain, xScale, yScale }
    ) {
      let { spacingTop, spacingBottom, spacingLeft, spacingRight } = props;

      const isDone = () =>
        _.every(
          [spacingTop, spacingBottom, spacingLeft, spacingRight],
          _.isNumber
        );

      // short-circuit if all spacing provided
      if (isDone())
        return { spacingTop, spacingBottom, spacingLeft, spacingRight };

      // if Component provides a custom static getSpacing method
      // use it to determine remaining domains
      if (_.isFunction(Component.getSpacing)) {
        const componentSpacing = omitNullUndefined(
          Component.getSpacing({
            ...props,
            xScaleType,
            yScaleType,
            xDomain,
            yDomain,
            xScale,
            yScale
          })
        );
        ({ spacingTop, spacingBottom, spacingLeft, spacingRight } = _.assign(
          componentSpacing,
          omitNullUndefined({
            spacingTop,
            spacingBottom,
            spacingLeft,
            spacingRight
          })
        ));
        if (isDone())
          return { spacingTop, spacingBottom, spacingLeft, spacingRight };
      }

      // if Component has children,
      // recurse through descendants to resolve their spacings the same way,
      // and combine them into a single spacing, if there are multiple
      if (React.Children.count(props.children)) {
        let childrenSpacings = mapOverChildren(
          props.children,
          this._resolveSpacing.bind(this),
          { xScaleType, yScaleType, xDomain, yDomain, xScale, yScale }
        );

        const childrenSpacing = combineBorderObjects(
          childrenSpacings.map(childSpacing => ({
            top: childSpacing.spacingTop,
            bottom: childSpacing.spacingBottom,
            left: childSpacing.spacingLeft,
            right: childSpacing.spacingRight
          }))
        );

        spacingTop = _.isUndefined(spacingTop)
          ? childrenSpacing.top
          : spacingTop;
        spacingBottom = _.isUndefined(spacingBottom)
          ? childrenSpacing.bottom
          : spacingBottom;
        spacingLeft = _.isUndefined(spacingLeft)
          ? childrenSpacing.left
          : spacingLeft;
        spacingRight = _.isUndefined(spacingRight)
          ? childrenSpacing.right
          : spacingRight;
      }

      if (isDone())
        return { spacingTop, spacingBottom, spacingLeft, spacingRight };
    }

    _makeScales = ({
      width,
      height,
      xScaleType,
      yScaleType,
      invertXScale,
      invertYScale,
      xDomain,
      yDomain,
      xScale,
      yScale,
      marginTop,
      marginBottom,
      marginLeft,
      marginRight,
      spacingTop,
      spacingBottom,
      spacingLeft,
      spacingRight
    }) => {
      const spacing = {
        top: spacingTop,
        bottom: spacingBottom,
        left: spacingLeft,
        right: spacingRight
      };
      const margin = {
        top: marginTop,
        bottom: marginBottom,
        left: marginLeft,
        right: marginRight
      };
      const innerChartWidth = innerWidth(width, margin);
      const innerChartHeight = innerHeight(height, margin);

      // use existing scales if provided, otherwise create new
      if (!isValidScale(xScale)) {
        //innerRange functions produce range (i.e. [5,20]) and map function normalizes to 0 (i.e. [0,15])
        const xRange = innerRangeX(innerChartWidth, spacing).map(
          v => v - (spacing.left || 0)
        );
        xScale = initScale(xScaleType)
          .domain(xDomain)
          .range(xRange);

        // reverse scale domain if `invertXScale` is passed
        if (invertXScale) {
          xScale.domain(xScale.domain().reverse());
        }
      }

      if (!isValidScale(yScale)) {
        const yRange = innerRangeY(innerChartHeight, spacing).map(
          v => v - (spacing.top || 0)
        );
        yScale = initScale(yScaleType)
          .domain(yDomain)
          .range(yRange);

        // reverse scale domain if `invertYScale` is passed
        if (invertYScale) {
          yScale.domain(yScale.domain().reverse());
        }
      }

      return { xScale, yScale };
    };

    render() {
      const { props } = this;
      const { width, height, invertXScale, invertYScale } = props;

      // scales not provided, so we have to resolve them
      // first resolve scale types and domains
      // const scaleType = this._resolveScaleType(props, ComposedComponent);
      const { xScaleType, yScaleType } = this._resolveScaleType(
        props,
        ComposedComponent
      );

      // const domain = this._resolveDomain(props, ComposedComponent, scaleType);
      let { xDomain, yDomain } = this._resolveDomain(
        props,
        ComposedComponent,
        xScaleType,
        yScaleType
      );
      if (invertXScale) xDomain = xDomain.slice().reverse();
      if (invertYScale) yDomain = yDomain.slice().reverse();

      // create a temporary scale with size & domain, which may be used by the Component to calculate margin/tickDomain
      // (eg. to create and measure labels for the scales)
      // let tempScale = this._makeScales(scaleOptions);
      let scaleOptions = {
        width,
        height,
        xScaleType,
        yScaleType,
        xDomain,
        yDomain,
        invertXScale,
        invertYScale,
        scaleX: props.scaleX,
        scaleY: props.scaleY,
        marginTop: props.marginTop,
        marginBottom: props.marginBottom,
        marginLeft: props.marginLeft,
        marginRight: props.marginRight,
        spacingTop: props.spacingTop,
        spacingBottom: props.spacingBottom,
        spacingLeft: props.spacingLeft,
        spacingRight: props.spacingRight,
        xScale: props.xScale,
        yScale: props.yScale
      };
      // create a temporary scale with size & domain, which may be used by the Component to calculate margin/tickDomain
      // (eg. to create and measure labels for the scales)
      let tempScale = this._makeScales(scaleOptions);
      let { xScale: tempXScale, yScale: tempYScale } = tempScale;

      // getTickDomain gives children the opportunity to modify the domain to include their scale ticks
      // (can't happen in getDomain, because it can't be done until the base domain/tempScale has been created)
      // nice-ing happens in the getTickDomain function inside of _resolveTickDomain
      const { xTickDomain, yTickDomain } = this._resolveTickDomain(
        props,
        ComposedComponent,
        {
          xScaleType,
          yScaleType,
          xDomain,
          yDomain,
          xScale: tempXScale,
          yScale: tempYScale
        }
      );
      if (isValidDomain(xTickDomain, dataTypeFromScaleType(xScaleType))) {
        xDomain = combineDomains(
          [xDomain, xTickDomain],
          dataTypeFromScaleType(xScaleType)
        );
      }
      if (isValidDomain(yTickDomain, dataTypeFromScaleType(yScaleType))) {
        yDomain = combineDomains(
          [yDomain, yTickDomain],
          dataTypeFromScaleType(yScaleType)
        );
      }

      // update tempScale to use new domain before creating margins
      scaleOptions = { ...scaleOptions, xDomain, yDomain };
      tempScale = this._makeScales(scaleOptions);

      // then resolve the margins
      const { marginTop, marginBottom, marginLeft, marginRight } = _.defaults(
        this._resolveMargin(props, ComposedComponent, {
          xScaleType,
          yScaleType,
          xDomain,
          yDomain,
          xScale: tempScale.xScale,
          yScale: tempScale.yScale
        }),
        {
          marginTop: 0,
          marginBottom: 0,
          marginLeft: 0,
          marginRight: 0
        }
      );

      const {
        spacingTop,
        spacingBottom,
        spacingLeft,
        spacingRight
      } = _.defaults(
        this._resolveSpacing(props, ComposedComponent, {
          xScaleType,
          yScaleType,
          xDomain,
          yDomain,
          xScale: tempScale.xScale,
          yScale: tempScale.yScale
        }),
        {
          spacingTop: 0,
          spacingBottom: 0,
          spacingLeft: 0,
          spacingRight: 0
        }
      );

      // create real scales from resolved margins
      scaleOptions = {
        ...scaleOptions,
        marginTop,
        marginBottom,
        marginLeft,
        marginRight,
        spacingTop,
        spacingBottom,
        spacingLeft,
        spacingRight
      };
      const { xScale, yScale } = this._makeScales(scaleOptions);

      const passedProps = _.assign({}, this.props, {
        xScale,
        yScale,
        xDomain,
        yDomain,
        xScaleType,
        yScaleType,
        marginTop,
        marginBottom,
        marginLeft,
        marginRight,
        spacingTop,
        spacingBottom,
        spacingLeft,
        spacingRight
      });
      return <ComposedComponent {...passedProps} />;

      // todo throw if cannot resolve scaleType
      // todo throw if cannot resolve domain
      // todo check to make sure margins didn't change after scales resolved?
    }
  };
}
