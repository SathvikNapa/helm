/**
 * A very simple static way to visualize the scenarios, runs, and metrics from the benchmarking project.
 * This code doesn't really belong in `proxy`, but is there for convenience.
 */
$(function () {
  const urlParams = decodeUrlParams(window.location.search);
  // Extract the name of the suite from the URL parameters. Default to "latest" if none is specified.
  const suite = "suite" in urlParams ? urlParams.suite : "latest";
  console.log(`Suite: ${suite}`);

  ////////////////////////////////////////////////////////////
  // Main

  // Captures information about a field of an adapter (e.g.,
  // max_train_instances) or a metric name (e.g., exact_match).
  class Field {
    constructor(raw) {
      this.name = raw.name;
      this.description = raw.description;
      // Possible values this field can take
      // Note: we are using field to represent the schema for a field value too.
      this.values = raw.values ? raw.values.map((valueRaw) => new Field(valueRaw)) : null;
    }
  }

  // Captures display specifications for a scenarioGroup.
  class ScenarioGroupField {
    constructor(raw) {
      this.name = raw.name;
      this.display = {
        k: raw.display.k || null,
        split: raw.display.split,
        stat_names: raw.display.stat_names,
      }
      // @TODO delete the following after the new run_spec.json files are generated
      this.className = raw.class_name;
      this.args = raw.args;
    }
  }

  // Specifies all the information to help us render and understand the fields
  // for adapters and metrics.
  class Schema {
    constructor(raw) {
      this.adapterFields = raw.adapter.map((fieldRaw) => new Field(fieldRaw));
      this.metricsFields = raw.metrics.map((fieldRaw) => new Field(fieldRaw));
      this.scenarioGroupsFields = raw.scenarioGroups.map((fieldRaw) => new ScenarioGroupField(fieldRaw));

      // Allow convenient access
      this.adapterFieldNames = this.adapterFields.map((field) => field.name);
      this.metricsFieldNames = this.metricsFields.map((field) => field.name);
      this.scenarioGroupsFieldNames = this.scenarioGroupsFields.map((field) => field.name);
    }

    adapterField(name) {
      // Return the adapter field with the given `name`.
      const field = this.adapterFields.find((field) => field.name === name);
      return field || new Field({name});
    }

    metricsField(name) {
      // Return the metrics field with the given `name`.
      const field = this.metricsFields.find((field) => field.name === name);
      return field || new Field({name});
    }

    scenarioGroupsField(name) {
      // Return the scenario group field with the given `name`.
      const field = this.scenarioGroupsFields.find((field) => field.name === name);
      return field || new Field({name});
    }
  }

  function describeField(field) {
    let result = field.name + ": " + field.description;
    if (field.values) {
      result += '\nPossible values:\n' + field.values.map(value => `- ${value.name}: ${value.description}`).join('\n');
    }
    return result;
  }

  function renderStopSequence(value) {
    return JSON.stringify(value);
  }

  function renderFieldValue(field, value) {
    if (!field.values) {
      if (field.name === 'stop_sequences') {
        return renderStopSequence(value);
      }
      return value;
    }
    const valueField = field.values.find(valueField => valueField.name === value);
    return $('<a>', {title: valueField ? valueField.description : '(no description)'}).append(value);
  }

  function perturbationEquals(perturbation1, perturbation2) {
    if (perturbation1 == null) {
      return perturbation2 == null;
    }
    if (perturbation2 == null) {
      return perturbation1 == null;
    }
    return renderDict(perturbation1) === renderDict(perturbation2);
  }

  function metricNameEquals(name1, name2) {
    return name1.name === name2.name &&
           name1.k === name2.k &&
           name1.split === name2.split &&
           name1.sub_split === name2.sub_split &&
           perturbationEquals(name1.perturbation, name2.perturbation);
  }

  function renderPerturbation(perturbation) {
    if (!perturbation) {
      return 'original';
    }
    // The perturbation field must have the "name" subfield
    const fields_str = Object.keys(perturbation)
                       .filter(key => key !== 'name')
                       .map(key => `${key}=${perturbation[key]}`)
                       .join(', ');
    return perturbation.name + (fields_str ? '(' + fields_str + ')' : '');
  }

  function renderMetricName(name) {
    // Return a short name (suitable for a cell of a table)
    // Example: name = {name: 'exact_match'}
    let result = name.name.bold();
    if (name.k) {
      result += '@' + name.k;
    }
    if (name.split) {
      result += ' on ' + name.split + (name.sub_split ? '/' + name.sub_split : '');
    }
    if (name.perturbation) {
      result += ' with ' + renderPerturbation(name.perturbation);
    }
    return result;
  }

  function describeMetricName(field, name) {
    // Return a longer description that explains the name
    let result = describeField(field);
    if (name.k) {
      result += `\n@${name.k}: consider the best over the top ${name.k} predictions`;
    }
    if (name.split) {
      result += `\non ${name.split}: evaluated on the subset of ${name.split} instances`;
    }
    if (name.perturbation) {
      result += `\nwith ${renderPerturbation(name.perturbation)}: applied this perturbation (worst means over all perturbations of an instance)`;
    }
    return result;
  }

  function renderModels(models) {
    const $table = $('<table>', {class: 'query-table'});
    models.forEach((model) => {
      const $row = $('<tr>').append($('<td>').append(`${model.description} [${model.name}]`));
      $table.append($row);
    });
    return $table;
  }

  function getLast(l) {
    return l[l.length - 1];
  }

  function renderScenarioSpec(spec) {
    // Example: benchmark.mmlu_scenario.MMLUScenario => MMLU
    const name = getLast(spec.class_name.split('.')).replace('Scenario', '');
    return name + '(' + renderDict(spec.args) + ')';
  }

  function renderRunsOverview(runSpecs) {
    let query = '';
    const $search = $('<input>', {type: 'text', size: 40, placeholder: 'Enter regex query (enter to open all)'});
    $search.keyup((e) => {
      // Open up all match specs
      if (e.keyCode === 13) {
        const href = encodeUrlParams(Object.assign(urlParams, {runSpec: '.*' + query + '.*'}));
        window.open(href);
      }
      query = $search.val();
      renderTable();
    });

    const $table = $('<table>', {class: 'query-table'});

    function renderTable() {
      $table.empty();
      const $header = $('<tr>')
          .append($('<td>').append($('<b>').append('Run')))
          .append($('<td>').append($('<b>').append('Scenario')))
          .append($('<td>').append($('<b>').append('Model')))
          .append($('<td>').append($('<b>').append('Adaptation method')));
      $table.append($header);

      runSpecs.forEach((runSpec) => {
        if (!new RegExp(query).test(runSpec.name)) {
          return;
        }
        const href = encodeUrlParams(Object.assign(urlParams, {runSpec: runSpec.name}));
        const $row = $('<tr>')
          .append($('<td>').append($('<a>', {href}).append(runSpec.name)))
          .append($('<td>').append(renderScenarioSpec(runSpec.scenario)))
          .append($('<td>').append(runSpec.adapter_spec.model))
          .append($('<td>').append(runSpec.adapter_spec.method))
        $table.append($row);
      });
    }

    renderTable();

    return $('<div>').append([$search, $table]);
  }

  function renderHeader(header, body) {
    return $('<div>').append($('<h4>').append(header)).append(body);
  }

  function getJSONList(paths, callback, defaultValue) {
    // Fetch the JSON files `paths`, and pass the list of results into `callback`.
    const responses = {};
    $.when(
      ...paths.map((path) => $.getJSON(path, {}, (response) => { responses[path] = response; })),
    ).then(() => {
      callback(paths.map((path) => responses[path] || defaultValue));
    }, (error) => {
      console.error('Failed to load / parse:', paths.filter((path) => !(path in responses)));
      console.error(error.responseText);
      JSON.parse(error.responseText);
      callback(paths.map((path) => responses[path] || defaultValue));
    });
  }

  function sortListWithReferenceOrder(list, referenceOrder) {
    // Return items in `list` based on referenceOrder.
    // Example:
    // - list = [3, 5, 2], referenceOrder = [2, 5]
    // - Returns [2, 5, 3]
    function getKey(x) {
      const i = referenceOrder.indexOf(x);
      return i === -1 ? 9999 : i;  // Put unknown items at the end
    }
    list.sort(([a, b]) => getKey(a) - getKey(b));
  }

  function canonicalizeList(lists) {
    // Takes as input a list of lists, and returns the list of unique elements (preserving order).
    // Example: [1, 2, 3], [2, 3, 4] => [1, 2, 3, 4]
    const result = [];
    lists.forEach((list) => {
      list.forEach((elem) => {
        if (result.indexOf(elem) === -1) {
          result.push(elem);
        }
      });
    });
    return result;
  }

  function dict(entries) {
    // Make a dictionary (object) out of the key/value `entries`
    const obj = {};
    entries.forEach(([key, value]) => {
      obj[key] = value;
    });
    return obj;
  }

  function findDiff(items) {
    // `items` is a list of dictionaries.
    // Return a corresponding list of dictionaries where all the common keys have been removed.
    const commonKeys = Object.keys(items[0]).filter((key) => items.every((item) => JSON.stringify(item[key]) === JSON.stringify(items[0][key])));
    return items.map((item) => {
      return dict(Object.entries(item).filter((entry) => commonKeys.indexOf(entry[0]) === -1));
    });
  }

  function renderDict(obj) {
    return Object.entries(obj).map(([key, value]) => `${key}=${value}`).join(',');
  }

  function renderRunsDetailed(runSpecs) {
    // Render all the `runSpecs`:
    // - Adapter specification
    // - Metric
    // - Instances + predictions
    // For each block, we show a table and each `runSpec` is a column.
    const CORRECT_TAG = 'correct';

    // Used to hash instances.
    function instanceKey(instance) {
      return JSON.stringify(instance);
    }

    // Paths (parallel arrays corresponding to `runSpecs`)
    const metricsPaths = runSpecs.map((runSpec) => {
      return `benchmark_output/runs/${suite}/${runSpec.name}/metrics.json`;
    });
    const scenarioPaths = runSpecs.map((runSpec) => {
      return `benchmark_output/runs/${suite}/${runSpec.name}/scenario.json`;
    });
    const scenarioStatePaths = runSpecs.map((runSpec) => {
      return `benchmark_output/runs/${suite}/${runSpec.name}/scenario_state.json`;
    });
    const runSpecPaths = runSpecs.map((runSpec) => {
      return `benchmark_output/runs/${suite}/${runSpec.name}/run_spec.json`;
    });

    // Figure out short names for the runs based on where they differ
    const runDisplayNames = findDiff(runSpecs.map((runSpec) => runSpec.adapter_spec)).map(renderDict);

    // Setup the basic HTML elements
    const $root = $('<div>');
    const $scenarioInfo = $('<div>', {class: 'scenario-info'});
    $root.append($scenarioInfo);

    $root.append($('<h5>').append('Adapter specification'));
    const $adapterSpec = $('<table>', {class: 'table'});
    if (runSpecs.length > 1) {
      $adapterSpec.append($('<tr>').append($('<td>'))
        .append(runDisplayNames.map((name) => $('<td>').append(name))));
    }
    $root.append($adapterSpec);

    $root.append($('<h5>').append('Metrics'));
    const $metrics = $('<table>', {class: 'table'});
    if (runSpecs.length > 1) {
      $metrics.append($('<tr>').append($('<td>')).append(runDisplayNames.map((name) => $('<td>').append(name))));
    }
    $root.append($metrics);

    $root.append($('<h5>').append('Instances'));
    const $instances = $('<div>');
    $root.append($instances);

    // Render adapter specs
    const keys = canonicalizeList(runSpecs.map((runSpec) => Object.keys(runSpec.adapter_spec)));
    sortListWithReferenceOrder(keys, schema.adapterFieldNames);
    keys.forEach((key) => {
      const field = schema.adapterField(key);
      const helpText = describeField(field);
      const $key = $('<td>').append($('<span>').append(helpIcon(helpText)).append(' ').append(key));
      const $row = $('<tr>').append($key);
      runSpecs.forEach((runSpec) => {
        $row.append($('<td>').append(renderFieldValue(field, runSpec.adapter_spec[key])));
      });
      $adapterSpec.append($row);
    });
    $adapterSpec.append($('<tr>').append($('<td>'))
      .append(runSpecPaths.map((runSpecPath) => $('<td>').append($('<a>', {href: runSpecPath}).append('JSON')))));

    // Render metrics
    getJSONList(metricsPaths, (metricsList) => {
      console.log('metrics', metricsList);
      const keys = canonicalizeList(metricsList.map((metrics) => metrics.map((metric) => metric.name)));

      keys.forEach((key) => {
        // For each key (MetricName - e.g., {name: 'exact_match', ...})
        const field = schema.metricsField(key.name);
        const helpText = describeMetricName(field, key);
        const $key = $('<td>').append($('<span>').append(helpIcon(helpText)).append(' ').append(renderMetricName(key)));
        const $row = $('<tr>').append($('<td>').append($key));
        metricsList.forEach((metrics) => {
          // metrics is a list of statistics corresponding to one run (column)
          const metric = metrics.find((metric) => metricNameEquals(metric.name, key));
          $row.append($('<td>').append(metric ? renderFieldValue(field, round(metric.mean, 3)) : '?'));
        });
        $metrics.append($row);
      });
      $metrics.append($('<tr>').append($('<td>'))
        .append(metricsPaths.map((metricsPath) => $('<td>').append($('<a>', {href: metricsPath}).append('JSON')))));
    }, []);

    // Render scenario instances
    const instanceToDiv = {};
    getJSONList(scenarioPaths, (scenarios) => {
      console.log('scenarios', scenarios);

      // Only grab the first scenario
      const i = 0;
      $scenarioInfo.append($('<h3>').append(scenarios[i].name));
      $scenarioInfo.append($('<div>').append($('<i>').append(scenarios[i].description)));
      $scenarioInfo.append($('<div>')
        .append($('<a>', {href: scenarios[i].definition_path}).append('[code]'))
        .append(' ').append($('<a>', {href: scenarioPaths[i]}).append('[JSON]'))
      );

      scenarios.forEach((scenario) => {
        scenario.instances.forEach((instance, instanceIndex) => {
          const key = instanceKey(instance);
          if (key in instanceToDiv) {
            return;
          }

          // Render instance
          $instances.append($('<hr>'));
          const $instance = $('<div>');
          $instance.append($('<b>').append(`Input ${instanceIndex} (${instance.split} - ${instance.id} ${renderPerturbation(instance.perturbation)})`));
          $instance.append(': ');
          $instance.append(multilineHtml(instance.input));
          const $references = $('<ul>');
          instance.references.forEach((reference) => {
            const isCorrect = reference.tags.includes(CORRECT_TAG);
            $references.append($('<li>').append($('<span>', {class: isCorrect ? 'correct' : ''}).append(reference.output)));
          });
          $instance.append($references);
          $instances.append($instance);
          instanceToDiv[key] = $instance;
        });
      });

      // Render the model predictions
      getJSONList(scenarioStatePaths, (scenarioStates) => {
        console.log('scenarioStates', scenarioStates);
        scenarioStates.forEach((scenarioState, index) => {
          scenarioState.request_states.forEach((requestState) => {
            const $instance = instanceToDiv[instanceKey(requestState.instance)];
            if (!$instance) {
              console.log('Not found: ' + instanceKey(requestState.instance));
              return;
            }

            // Create a link for the request made to the server
            const request = Object.assign({}, requestState.request);
            const prompt = request.prompt;
            delete request.prompt;
            const query = {
              prompt,
              settings: JSON.stringify(request),
              environments: '',
            };
            const href = '/static/index.html' + encodeUrlParams(query);

            // Render the prediction
            let prediction = $('<i>').append('(empty)');
            if (requestState.result) {
              prediction = requestState.result.completions[0].text.trim();
              if (requestState.output_mapping) {
                prediction = requestState.output_mapping[prediction];
              }
            }
            const isCorrect = requestState.instance.references.some((reference) => reference.tags.includes(CORRECT_TAG) && reference.output === prediction);
            $instance.append($('<div>')
              .append($('<a>', {href}).append($('<b>').append(runSpecs.length > 1 ? `Prediction (${runDisplayNames[index]})` : 'Prediction')))
              .append(': ')
              .append($('<span>', {class: isCorrect ? 'correct' : ''}).append(prediction)));
          });
        });
      });
    });

    return $root;
  }

  //////////////////////////////////////////////////////////////////////////////
  //                        [BEGIN] Handy functions                           //
  //////////////////////////////////////////////////////////////////////////////

  // Functions in this section are finalized, - no further re-factoring planned.
  // TODO: Remove the section comments once all the refactoring is complete.

  function joinRunSpecNames(runs) {
    const runSpecNames = runs.map(run => run.run_spec.name);
    return runSpecNames.join('&');
  }

  function getScenarioSpecNameFromRunSpecName(runSpecName) {
    // Extract scenario name from a run spec name. Example:
    //   runSpecName: "boolq:model=ai21_j1-jumbo,data_augmentation=canonical"
    //   scenarioName: "boolq"
    // NOTE: We should ideally avoid parsing strings, but there is no other
    //   way to get this information.
    return runSpecName.split(':')[0];
  }

  function filterRunsByGroup(runs, group) {
    return runs.filter(run => checkRunGroupMatch(run, group));
  }

  function filterRunsByGroups(runs, groups) {
    return runs.filter(run => {
      var match = false;
      groups.forEach(group => {
        match = match || checkRunGroupMatch(run, group);
      });
      return match;
  })};

  //////////////////////////////////////////////////////////////////////////////
  //                          [END] Handy functions                           //
  //////////////////////////////////////////////////////////////////////////////

  // ------------------------------------------------------------------------ //

  //////////////////////////////////////////////////////////////////////////////
  //     [BEGIN] Functions in the below section can be re-factored better.    //
  //////////////////////////////////////////////////////////////////////////////

  function getStatsFromRun(run, statName, perturbationName, k, split) {
    return stats = run.stats.filter(stat => {
      // TODO iterate automatically
      const statNameMatch = stat.name.name === statName;
      const perturbationNameMatch = (stat.name.perturbation ? stat.name.perturbation.name : null) === perturbationName;
      const splitMatch = stat.name.split === split;
      const kMatch = stat.name.k === k;
      return statNameMatch && perturbationNameMatch && splitMatch && kMatch;
  })}

  function groupByModel(runs) {
    // Group runs by model name. Return a dictionary mapping each model name to
    // a list of runs.
    const runsGroupedByModel = runs.reduce((r, run) => {
      model = run.run_spec.adapter_spec.model;
      r[model] = r[model] || [];
      r[model].push(run);
      return r;
    }, {});
    return runsGroupedByModel;
  }

  function stringifyObject(obj) {
    var stringArr = [];
    Object.keys(obj).forEach(key => stringArr.push(`${key}=${obj[key]}`));
    return stringArr.join(',');
  }

  function createScenarioMetadataString(scenarioSpecName, scenarioSpecArgs) {
    if (scenarioSpecArgs && Object.keys(scenarioSpecArgs).length > 0) {
      // TODO
      const argsString = stringifyObject(scenarioSpecArgs);
      return [scenarioSpecName, argsString].join(':');
    }
    return scenarioSpecName;
  }

  function groupByScenarioMetadata(runs) {
    const runsGroupedByScenarioMetadata = runs.reduce((r, run) => {
      const scenarioSpecName = getScenarioSpecNameFromRunSpecName(run.run_spec.name);
      const scenarioSpecArgs = run.run_spec.scenario.args;
      const scenarioMetadataString = createScenarioMetadataString(scenarioSpecName, scenarioSpecArgs);
      const defaultValue = {scenarioSpecName: scenarioSpecName, scenarioSpecArgs: scenarioSpecArgs, runs: []};
      r[scenarioMetadataString] = r[scenarioMetadataString] || defaultValue;
      r[scenarioMetadataString].runs.push(run);
      return r;
    }, {});
    return runsGroupedByScenarioMetadata;
  }

  function renderTable(headers, data, tableClass) {
    // TODO make the table prettier
    // TODO show stddev / confidence interval
    // TODO Detail hrefLinkFieldName
    // Render table with the given headers, data, and tableClass.
    const $table = $('<table>', {class: tableClass});
    $table.empty();

    // Render header
    const $header = $('<tr>');
    headers.forEach(ht => $header.append($('<td>').append($('<b>').append(ht))));
    $table.append($header);

    // Render data
    data.forEach(d => {
      const $row = $('<tr>');
      headers.forEach(ht => {
        if (d[ht].href) {
          $row.append($('<a>', {href: d[ht].href}).append(d[ht].value));
        } else {
          $row.append($('<td>').append(d[ht]));
        }
      });
      $table.append($row);
    });

    return $table;
  }

  function toDecimalStrings(dataArr, numDecimals=3) {
    dataArr.forEach(dataRow => {
      Object.keys(dataRow).forEach(k => {
        if (typeof dataRow[k] === 'number') {
          dataRow[k] = dataRow[k].toLocaleString("en-US", {maximumFractionDigits: numDecimals, minimumFractionDigits: numDecimals});
        }
    })});
  }

  function checkRunGroupMatch(run, group) {
    // Return whether the run belongs to the provided scenario group
    // @TODO Replace the following logic to compare against the groups field once #586 is merged and
    // the benchmark is re-run.
    const scenario = run.run_spec.scenario;
    var classNameCondition = scenario.class_name === group.className;
    var argsCondition = true;
    if (group.args) {
      for (const key in group.args) {
        argsCondition = scenario.args.hasOwnProperty(key) ? scenario.args[key] === group.args[key] : argsCondition;
      }
    }
    return classNameCondition && argsCondition;
  }

  function statNameToDisplayName(statName, perturbationName) {
    // Converts a statName and a statType to a string ready to be displayed to the user
    //   statNameToDisplayName("f1_score", "Synonym Perturbation") => "F1 score (Synonym Perturbation)"

    const displayNameMappingDict = {
      // Stat names
      // TODO The name mappings here should be moved to the schema.
      training_co2_cost: "Training CO2 Cost",
      inference_idealized_runtime: "Inference Runtime (Idealized)",
      // Perturbation names
      // @TODO standardize perturbation names in the python code
      TyposPerturbation: 'Typos Perturbation',
      SynonymPerturbation: 'Synonym Perturbation',
      dialect: 'Dialect Perturbation',
      person_name: 'Race Perturbation',
      gender_term: 'Gender Perturbation',
      'bias: category=race, target=profession': 'Bias (Race, Profession)',
      'bias: category=gender, target=profession': 'Bias (Gender, Profession)',
      'erasure: category=race': 'Bias (Race)',
      'erasure: category=gender': 'Bias (Gender)'
    };

    if (statName in displayNameMappingDict) {
      statName = displayNameMappingDict[statName]
    } else {
      statName = statName.replaceAll('_', ' ');
      statName = statName.charAt(0).toUpperCase() + statName.slice(1);
    }

    return perturbationName ? statName + " (" + displayNameMappingDict[perturbationName] + ")" : statName;
  }


  function getAverageStats(displayStatArr) {
    // TODO document and clean up.
    // Result is an object where each value is a list of stats that can be averaged.
    // TODO we should probably keep track of stddev.
    var combinedDisplayStats = {};
    for (const displayStat of displayStatArr) {
      for (statName in displayStat) {
        combinedDisplayStats[statName] = combinedDisplayStats[statName] || [];
        combinedDisplayStats[statName] = combinedDisplayStats[statName].concat(displayStat[statName]);
      };
    };
    // Average the stats.
    const result = {}
    Object.keys(combinedDisplayStats).forEach(key => {
      const numStats = combinedDisplayStats[key].length;
      const sumMean = combinedDisplayStats[key].map(stat => stat.mean).reduce((acc, val) => {
        acc += val;
        return acc;
      }, 0);
      result[key] = numStats > 0 ? sumMean / numStats : undefined;
    });
    return result;
  }

  function getDisplayStatDictFromRun(run, statName, k, split, perturbationName) {
    const stats = getStatsFromRun(run, statName, perturbationName, k, split);
    var displayStat = {};
    if (stats.length > 0) {
      const displayName = statNameToDisplayName(statName);
      displayStat[displayName] = stats;
    };
    return displayStat;
  }

  function getPerturbationDisplayStatsFromRun(run, statName, k, split) {
    // Perturbation names
    const perturbationNames = ['TyposPerturbation', 'SynonymPerturbation', 'dialect', 'person_name', 'gender_term'];

    var displayStats = {};
    perturbationNames.forEach(perturbationName => {
      const stats = getStatsFromRun(run, statName, perturbationName, k, split);
      if (stats.length > 0) {
        displayStats[statNameToDisplayName(statName, perturbationName)] = stats;
      };
    });

    return displayStats;
  }

  function getBiasAndToxicityDisplayStats(run, k, split) {
    // Stat names
    const perturbationName = null;
    const statNames = ['bias: category=race, target=profession', 'bias: category=gender, target=profession', 'erasure: category=race', 'erasure: category=gender'];

    var displayStats = {};
    statNames.forEach(statName => {
      const stats = getStatsFromRun(run, statName, perturbationName, k, split);
      if (stats.length > 0) {
        displayStats[statNameToDisplayName(statName, perturbationName)] = stats;
      };
    });

    return displayStats;
  }

  function getRuntimeDisplayStats(run, k, split) {
    // Display stats to be populated
    var displayStats = {};

    // Runtime stat names
    const runTimeStatNames = ["inference_runtime", "inference_idealized_runtime", "training_co2_cost"];

    runTimeStatNames.forEach(statName => {
      // For runtime scenarios, we pick the stats where perturbation is null
      const stats = getStatsFromRun(run, statName, null, k, split);
      if (stats.length) {
        displayStats[statNameToDisplayName(statName)] = stats
      };
    });

    return displayStats;
  }

  function getTableDisplayStats(run, statNames, k, split) {
    // TODO rename this function
    // TODO document 

    var displayStatsArr = [];  // TODO rename

    statNames.forEach(statName => {
      // Accuracy stat (w perturbations)
      // TODO Ensure that the identity perturbation is appropriate
      // TODO replace push once the display stat object is implemented
      displayStatsArr.push(getDisplayStatDictFromRun(run, statName, k, split, 'identity'));
      displayStatsArr.push(getPerturbationDisplayStatsFromRun(run, statName, k, split, 'identity'));
    });

    // Toxicity and bias
    displayStatsArr.push(getBiasAndToxicityDisplayStats(run, k, split));

    // Run Time
    displayStatsArr.push(getRuntimeDisplayStats(run, k, split));

    // Flatten the array into a dictionary
    // TODO revisit after the display stats object is implemented
    var combinedDisplayStats = {};
    for (const displayStat of displayStatsArr) {
      for (statName in displayStat) {
        combinedDisplayStats[statName] = combinedDisplayStats[statName] || [];
        combinedDisplayStats[statName] = combinedDisplayStats[statName].concat(displayStat[statName]);
      };
    };

    return combinedDisplayStats;
  }

  function renderTableExplainer(runs, tableTitle) {
    // TODO Re-factor
    const $tableExplainer = $('<div>');
    const runsGroupedByScenarioMetadata = groupByScenarioMetadata(runs);

    // Table title
    if (!(tableTitle)) {
      Object.keys(runsGroupedByScenarioMetadata).forEach(scenarioMetadataString => {
        const metadata = runsGroupedByScenarioMetadata[scenarioMetadataString];
        const args = metadata.scenarioSpecArgs;
        tableTitle = `${metadata.scenarioSpecName}`;
        if (Object.keys(args).length > 0) {
          const argValues = Object.values(args).join(', ');
          tableTitle += ` (${argValues})`;
        }
      });
    }
    $tableExplainer.append($('<h2>').append(tableTitle));

    // Table information
    const scenarioMetadataNamesRegex = '.*' + Object.keys(runsGroupedByScenarioMetadata).join('.*&.*') + '.*';
    const predictionsHref = `benchmarking.html?runSpec=${scenarioMetadataNamesRegex}`;
    $tableExplainer.append($('<a>', {href: predictionsHref}).append(`All predictions for the table`));

    return $tableExplainer;
  }

  function renderModelRunStatsTable(runs, schema, includeMetadata, tableTitle) {
    // Creates the model by stats table by aggregating the runs.
    //   Links to predictions / specific run specs available based on the number
    //   runs that are aggregated.
    // TODO we can automatically decide whether to include links or not, possible refactor
    // TODO this can be a generic table taking a "groupby" function with a field name
    // TODO we can re-factor the explainer part from the table part, but it will cause some repetition

    // Construct the table explainer, including table name and any explanation.
    const $tableContainer =  $('<div>');

    // Group runs by model
    const runsGroupedByModel = groupByModel(runs);

    // Table explainer
    const $tableExplainer = renderTableExplainer(runs, tableTitle);
    $tableContainer.append($tableExplainer);

    // Get table data
    var data = [];
    Object.keys(runsGroupedByModel).forEach(model => {
      var modelDisplayStats = []; // TODO rename
      const modelRuns = runsGroupedByModel[model];

      modelRuns.forEach(run => {
        // Get display settings
        const groupName = run.run_spec.groups[0]; // We select the first group name to get display settings
        const display = schema.scenarioGroupsField(groupName).display; // TODO rename scenario groups
        const k = display.k, split = display.split, statNames = display.stat_names;

        // Get display stats
        const runDisplayStats = getTableDisplayStats(run, statNames, k, split);
        modelDisplayStats.push(runDisplayStats);
      });
      // Combine all stats of the same name and average
      // TODO this can happen later
      var dataRow = getAverageStats(modelDisplayStats);

      // Add model information
      if (includeMetadata) {
        const joinedRunSpecNames = joinRunSpecNames(modelRuns); // TODO must
        const href = encodeUrlParams(Object.assign(urlParams, {runSpec: joinedRunSpecNames}));
        dataRow = {'Model': {'href': href, 'value': model}, ...dataRow};
      } else {
        dataRow = {'Model': model, ...dataRow};
      }

      // Add to data
      data = data.concat(dataRow);
    });

    // Prepare the table
    // TODO Clean up and re-factor
    // Get headers
    const headers = data.reduce((r, dataRow) => {
      Object.keys(dataRow).forEach(key => {
        r = r || [];
        if (!(r.includes(key))) {r.push(key)};
      });
      return r;
    }, []);

    // Render table
    toDecimalStrings(data, numDecimals=3);
    const $table = renderTable(headers, data, 'scenario-table');
    $tableContainer.append($table);

    return $tableContainer;
  }

  function renderScenarioSpecsPage(runs, schema)  {
    // TODO document this function, change name
    // Page showing stats for a scenario spec
    // Runs should already be filtered.
    const $root = $('<div>');
    const includeMetadata = true;
    $root.append(renderModelRunStatsTable(runs, schema, includeMetadata));
    return $root;
  }

  function renderGroupsPage(groups, runs, schema) {
    // Page showing aggregate stats for the passed groups.
    // TODO Add group explainer.

    // Information panel
    const $root = $('<div>');
    const groupsTitle = groups.map(s => s.name).join(", ");
    $root.append($('<h1>').append(groupsTitle));
    
    // Group table
    const groupsRuns = filterRunsByGroups(runs, groups); // TODO groupsruns sound weird
    var includeMetadata = false;
    const tableTitle = `${groupsTitle} Group`;
    const $groupTableContainer = renderModelRunStatsTable(groupsRuns, schema, true, tableTitle);
    $root.append($groupTableContainer);

    // Individual tables
    includeMetadata = true;
    const runsGroupedByScenarioMetadata = groupByScenarioMetadata(groupsRuns);
    Object.keys(runsGroupedByScenarioMetadata).forEach(scenarioMetadataString => {
      const scenarioMetadataRuns = runsGroupedByScenarioMetadata[scenarioMetadataString].runs;
      const $subTableContainer = renderModelRunStatsTable(scenarioMetadataRuns, schema, includeMetadata);
      $root.append($subTableContainer);
    });

    return $root;
  }

  //////////////////////////////////////////////////////////////////////////////
  //       [END] TODO functions in the above section can be re-factored.      //
  //////////////////////////////////////////////////////////////////////////////

  const $main = $('#main');
  let models, runSpecs, runs, schema;
  $.when(
    $.getJSON(`benchmark_output/runs/${suite}/models.json`, {}, (response) => {
      models = response;
      console.log('models', models);
    }),
    $.getJSON(`benchmark_output/runs/${suite}/run_specs.json`, {}, (response) => {
      runSpecs = response;
      console.log('runSpecs', runSpecs);
    }),
     $.getJSON(`benchmark_output/runs/${suite}/runs.json`, {}, (response) => {
      runs = response;
      console.log('runs', runs);
    }),
    $.get('schema.yaml', {}, (response) => {
      const raw = jsyaml.load(response);
      console.log('schema', raw);
      schema = new Schema(raw);
    }),
  ).then(() => {
    $main.empty();
    if (urlParams.models) {
      $main.append(renderHeader('Models', renderModels(models)));
    } else if (urlParams.runSpec) {
      const matchedRunSpecs = runSpecs.filter((runSpec) => new RegExp('^' + urlParams.runSpec + '$').test(runSpec.name));
      if (matchedRunSpecs.length === 0) {
        $main.append(renderError('No matching runs'));
      } else {
        $main.append(renderRunsDetailed(matchedRunSpecs));
      }
    } else if (urlParams.scenarioSpec) {
      // TODO Change matching so that scenario ...
      const matchedRuns = runs.filter((run) => new RegExp('^.*' + urlParams.scenarioSpec + '.*$').test(run.run_spec.name));
      if (matchedRuns.length === 0) {
        $main.append(renderError('No matching runs'));
      } else {
        $main.append(renderScenarioSpecsPage(matchedRuns, schema));
      }
    } else if (urlParams.group) {
      // TODO When we use the RegExp above we don't catch the groups. Debug.
      const matchedGroups = schema.scenarioGroupsFields.filter((group) => urlParams.group.includes(group.name));
      if (matchedGroups.length === 0) {
        $main.append(renderError('No matching groups'));
      } else {
        $main.append(renderGroupsPage(matchedGroups, runs, schema));
      }
    } else {
      $main.append(renderHeader('Runs', renderRunsOverview(runSpecs)));
    }
  });
});
