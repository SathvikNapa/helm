/**
 * A very simple static way to visualize the scenarios, runs, and metrics from the benchmarking project.
 * This code doesn't really belong in `proxy`, but is there for convenience.
 */
$(function () {
  const urlParams = decodeUrlParams(window.location.search);
  // Extract the name of the suite from the URL parameters. Default to "latest" if none is specified.
  const suite = "suite" in urlParams ? urlParams.suite : "latest";
  console.log(`Suite: ${suite}`);

  //////////////////////////////// Schema //////////////////////////////////////

  // Captures information about a field in the schema.
  class Field {
    constructor(raw) {
      this.name = raw.name;
      this.display_name = raw.display_name;
      this.description = raw.description;
    }
  }

  // Captures information about a field of an adapter (e.g.,
  // max_train_instances) or a metric name (e.g., exact_match).
  class AdapterField extends Field {
    constructor(raw) {
      super(raw);
      this.values = this.readValues(raw.values);
    }

    readValues(values) {
      // Read the values field.
      // Note: We are using `Field` to represent the schema for a field value too.
      if (Array.isArray(values)) {
        // If the values field is an array, read each element as a Field.
        return values.map((valueRaw) => new Field(valueRaw));
      } else if (values === undefined) {
        return undefined;
      }
      // If no matching schema is found, raise an error!
      console.error(`The values field of ${this.name} should be an array or an object. Instead found: ${values}.`);
    }
  }

  // Specifies all the information to help us render and understand the fields
  // for adapters and metrics.
  class Schema {
    constructor(raw) {
      this.adapterFields = raw.adapter.map((fieldRaw) => new AdapterField(fieldRaw));
      this.metricsFields = raw.metrics.map((fieldRaw) => new Field(fieldRaw));

      // Allow convenient access
      this.adapterFieldNames = this.adapterFields.map((field) => field.name);
      this.metricsFieldNames = this.metricsFields.map((field) => field.name);
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
  }

  /////////////////////////////////// Pages ////////////////////////////////////

  function renderModels(models) {
    // TODO: show better information, perhaps link to ecosystem graphs
    const $table = $('<table>', {class: 'query-table'});
    models.forEach((model) => {
      const $row = $('<tr>').append([
        $('<td>').append(model.display_name),
        $('<td>').append(model.description),
        $('<td>').append(model.name),
      ]);
      $table.append($row);
    });
    return $table;
  }

  function renderGroups(groups) {
    const $table = $('<table>', {class: 'query-table'});
    groups.forEach((group) => {
      const params = encodeUrlParams(Object.assign({}, {group: group.name}));
      const href = `benchmarking.html${params}`;
      const $row = $('<tr>').append([
        $('<td>').append($('<a>', {href: href}).append(group.display_name)),
        $('<td>').append(group.description),
      ]);
      $table.append($row);
    });
    return $table;
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
          .append($('<td>').append($('<b>').append('Adaptation method')));
      $table.append($header);

      runSpecs.forEach((runSpec) => {
        if (!new RegExp(query).test(runSpec.name)) {
          return;
        }
        // To maintain backward compatibility, as `scenario` in `RunSpec` was renamed to `scenario_spec`.
        const scenario_spec = runSpec.hasOwnProperty('scenario_spec') ? runSpec.scenario_spec : runSpec.scenario;
        const href = encodeUrlParams(Object.assign(urlParams, {runSpec: runSpec.name}));
        const $row = $('<tr>')
          .append($('<td>').append($('<a>', {href}).append(runSpec.name)))
          .append($('<td>').append(runSpec.adapter_spec.method))
        $table.append($row);
      });
    }

    renderTable();

    return $('<div>').append([$search, $table]);
  }

  function renderRunsDetailed(runSpecs) {
    // Render all the `runSpecs`:
    // - Instances + predictions
    // - Adapter specification
    // - Stats
    // For each block, we show a table and each `runSpec` is a column.
    const CORRECT_TAG = 'correct';

    // Used to hash instances.
    function instanceKey(instance) {
      return JSON.stringify(instance);
    }

    // Paths (parallel arrays corresponding to `runSpecs`)
    const metricsPaths = runSpecs.map((runSpec) => {
      return `benchmark_output/runs/${suite}/${runSpec.name}/stats.json`;
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
    $scenarioInfo.append('Loading...');
    $root.append($scenarioInfo);

    // Adapter
    $root.append($('<a>', {name: 'adapter'}).append($('<h5>').append('Adapter')));
    const $adapterSpec = $('<table>');
    if (runSpecs.length > 1) {
      $adapterSpec.append($('<tr>').append($('<td>'))
        .append(runDisplayNames.map((name) => $('<td>').append(name))));
    }
    $root.append($('<div>', {class: 'table-container'}).append($adapterSpec));

    // Instances
    $root.append($('<a>', {name: 'instances'}).append($('<h5>').append('Instances')));
    const $instances = $('<div>');
    $root.append($('<div>', {class: 'table-container'}).append($instances));

    // Metrics
    $root.append($('<a>', {name: 'metrics'}).append($('<h5>').append('Metrics')));
    const $metrics = $('<table>');
    const $metricsSearch = $('<input>', {type: 'text', size: 40, placeholder: 'Enter keywords to filter metrics'});
    if (runSpecs.length > 1) {
      $metrics.append($('<tr>').append($('<td>')).append(runDisplayNames.map((name) => $('<td>').append(name))));
    }
    $root.append($('<div>', {class: 'table-container'}).append($metricsSearch).append($metrics));

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

      // Sort
      keys.sort((k1, k2) => {
        const splitCompare = (k1.split || '').localeCompare(k2.split || '');
        if (splitCompare !== 0) {
          return splitCompare;
        }
        const nameCompare = k1.name.localeCompare(k2.name);
        if (nameCompare !== 0) {
          return nameCompare;
        }
        const perturbationCompare = (k1.perturbation ? k1.perturbation.name : '').localeCompare(k2.perturbation ? k2.perturbation.name : '');
        if (perturbationCompare !== 0) {
          return perturbationCompare;
        }
        return 0;
      });

      // Filter 
      let query = '';
      $metricsSearch.keyup((e) => {
        query = $metricsSearch.val();
        renderMetrics();
      });

      function renderMetrics() {
        $metrics.empty();
        keys.forEach((key) => {
          // For each key (MetricName - e.g., {name: 'exact_match', ...})

          if (key.perturbation && key.perturbation.computed_on !== 'worst') {
            // Only pay attention to worst (match `summarize.py`)
            return;
          }

          const displayKey = renderMetricName(key);
          if (query !== '' && !query.split(' ').every((q) => displayKey.includes(q))) {
            return;
          }

          const field = schema.metricsField(key.name);
          const helpText = describeMetricName(field, key);
          const $key = $('<td>').append($('<span>').append(helpIcon(helpText)).append(' ').append(displayKey));
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
      }

      renderMetrics();

    }, []);

    function highlightNewWords(text, origText) {
      // Render `text`, highlighting any words that don't occur in `origText`
      // Ideally, we would form an alignment between `text` and `origText` and
      // show the full diff, but that's too expensive.
      const origWords = {};
      origText.split(' ').forEach((word) => {
        origWords[word] = true;
      });
      return text.split(' ').map((word) => origWords[word] ? word : '<u>' + word + '</u>').join(' ');
    }

    // Render scenario instances
    const instanceToDiv = {};
    getJSONList(scenarioPaths, (scenarios) => {
      console.log('scenarios', scenarios);

      // Only grab the first scenario
      const i = 0;
      $scenarioInfo.empty();
      $scenarioInfo.append($('<h3>').append(scenarios[i].name));
      $scenarioInfo.append($('<div>').append($('<i>').append(scenarios[i].description)));
      $scenarioInfo.append($('<div>')
        .append($('<a>', {href: scenarios[i].definition_path}).append('[code]'))
        .append(' ').append($('<a>', {href: scenarioPaths[i]}).append('[JSON]'))
        .append(' ').append($('<a>', {href: '#adapter'}).append('[adapter]'))
        .append(' ').append($('<a>', {href: '#instances'}).append('[instances]'))
        .append(' ').append($('<a>', {href: '#metrics'}).append('[metrics]'))
      );

      scenarios.forEach((scenario) => {
        // Keep track of the original (unperturbed) instances
        const id2originalInstance = {};
        scenario.instances.forEach((instance) => {
          if (!instance.perturbation) {
            id2originalInstance[instance.id] = instance;
          }
        });

        scenario.instances.forEach((instance, instanceIndex) => {
          const key = instanceKey(instance);
          if (key in instanceToDiv) {
            return;
          }

          if (!instance.perturbation) {
            $instances.append($('<hr>'));
          } else {
            $instances.append($('<br>'));
          }
          const $instance = $('<div>');

          // For perturbations of an instance, highlight the diff between the unperturbed instance with the same ID
          const originalInstance = id2originalInstance[instance.id];

          let header;
          if (!instance.perturbation) {
            header = `Instance ${instance.id} [split: ${instance.split}]`;
          } else {
            header = '...with perturbation: ' + renderPerturbation(instance.perturbation);
          }

          $instance.append($('<b>').append(header));

          // We can hide the inputs and outputs to focus on the predictions
          if (!urlParams.hideInputOutput) {
            $instance.append('<br>');
            const input = instance.perturbation ? highlightNewWords(instance.input, originalInstance.input) : instance.input;
            $instance.append(multilineHtml(input));
            const $references = $('<ul>');
            instance.references.forEach((reference, referenceIndex) => {
              const isCorrect = reference.tags.includes(CORRECT_TAG);
              const originalReference = instance.perturbation && originalInstance.references[referenceIndex];
              const output = instance.perturbation ? highlightNewWords(reference.output, originalReference.output) : reference.output;
              $references.append($('<li>').append($('<span>', {class: isCorrect ? 'correct' : ''}).append(output)));
            });
            $instance.append($references);
          }
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

  function renderLandingPage() {
    const $intro = $('<div>').append('Welcome to the CRFM benchmarking project!');
    const $links = $('<ul>').append(
      $('<li>').append($('<a>', {href: '?models'}).append('Models')),
      $('<li>').append($('<a>', {href: '?groups'}).append('Scenario groups')),
      $('<li>').append($('<a>', {href: '?runs'}).append('Runs')),
    );
    return $('<div>').append($intro).append($links);
  }

  function renderCell(cell) {
    const value = $('<span>', {title: cell.description}).append(cell.display_value || cell.value);
    return $('<td>').append(cell.href ? $('<a>', {href: cell.href}).append(value) : value);
  }

  function renderTable(table) {
    const $output = $('<div>');
    $output.append($('<h3>').append(table.title));
    const $table = $('<table>', {class: 'query-table results-table'});
    const $header = $('<tr>').append(table.header.map(renderCell));
    $table.append($header);

    table.rows.forEach((row) => {
      const $row = $('<tr>').append(row.map(renderCell));
      $table.append($row);
    });
    $output.append($table);
    $output.append($('<a>', {href: '?latex=' + table.title.replaceAll(" ", "_").replace("/", "_")}).append('[latex]'));
    return $output;
  }

  function renderTables(tables) {
    const $output = $('<div>');
    tables.forEach((table) => {
      $output.append($('<div>', {class: 'table-container'}).append(renderTable(table)));
    });
    return $output;
  }

  function renderLatex(latex) {
    const $output = $('<div>', {class: 'latex'}).append(latex);
    return $output;
  }

  //////////////////////////////////////////////////////////////////////////////
  //                                   Main                                   //
  //////////////////////////////////////////////////////////////////////////////

  const $main = $('#main');
  $.when(
    $.get('schema.yaml', {}, (response) => {
      const raw = jsyaml.load(response);
      console.log('schema', raw);
      schema = new Schema(raw);
    }),
  ).then(() => {
    $main.empty();
    if (urlParams.models) {
      $.getJSON(`benchmark_output/runs/${suite}/models.json`, {}, (response) => {
        const models = response;
        console.log('models', models);
        $main.append(renderHeader('Models', renderModels(models)));
      });
    } else if (urlParams.runSpec) {
      // Display a set of run specs
      $.getJSON(`benchmark_output/runs/${suite}/run_specs.json`, {}, (response) => {
        const runSpecs = response;
        console.log('runSpecs', runSpecs);
        const matchedRunSpecs = runSpecs.filter((runSpec) => new RegExp('^' + urlParams.runSpec + '$').test(runSpec.name));
        if (matchedRunSpecs.length === 0) {
          $main.append(renderError('No matching runs'));
        } else {
          $main.append(renderRunsDetailed(matchedRunSpecs));
        }
      });
    } else if (urlParams.runs) {
      // Search over all runs
      $.getJSON(`benchmark_output/runs/${suite}/run_specs.json`, {}, (response) => {
        const runSpecs = response;
        console.log('runSpecs', runSpecs);
        $main.append(renderHeader('Runs', renderRunsOverview(runSpecs)));
      });
    } else if (urlParams.groups) {
      // All groups
      $.getJSON(`benchmark_output/runs/${suite}/groups.json`, {}, (response) => {
        $main.append(renderTable(response));
      });
    } else if (urlParams.group) {
      // Specific group
      $.getJSON(`benchmark_output/runs/${suite}/groups/${urlParams.group}.json`, {}, (tables) => {
        console.log('group', tables);
        $main.append(renderTables(tables));
      });
    } else if (urlParams.latex) {
      // Tex corresponding to a group
      $.get(`benchmark_output/runs/${suite}/groups/latex/${urlParams.latex}.tex`, {}, (latex) => {
        console.log('latex', latex);
        $main.append(renderLatex(latex));
      });
    } else {
      $main.append(renderLandingPage());
    }
  });
});
