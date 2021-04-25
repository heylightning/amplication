import React, {
  useCallback,
  useEffect,
  useMemo,
  useReducer,
  useState,
} from "react";
import classNames from "classnames";
import { isEmpty, forEach, cloneDeep } from "lodash";
import omitDeep from "deepdash-es/omitDeep";

import { FieldArray, Formik, useFormikContext } from "formik";
import { Form } from "../Components/Form";
import { gql, useMutation } from "@apollo/client";
import * as XLSX from "xlsx";
import { useDropzone } from "react-dropzone";
import * as models from "../models";
import MainLayout from "../Layout/MainLayout";
import "./CreateApplicationFromExcel.scss";
import { useHistory } from "react-router-dom";
import { useTracking } from "../util/analytics";
import { GET_APPLICATIONS } from "./Applications";
import { formatError } from "../util/error";
import { Snackbar } from "@rmwc/snackbar";
import { Button, EnumButtonStyle } from "../Components/Button";
import { CircularProgress } from "@rmwc/circular-progress";
import { DisplayNameField } from "../Components/DisplayNameField";
import Xarrow from "react-xarrows";

// import { DATA_TYPE_OPTIONS } from "../Entity/DataTypeSelectField";
// import { SelectField } from "@amplication/design-system";
import {
  DragDropContext,
  Droppable,
  Draggable,
  DropResult,
} from "react-beautiful-dnd";
import { DATA_TYPE_TO_LABEL_AND_ICON } from "../Entity/constants";
import EditableLabelField from "../Components/EditableLabelField";
import { DraggableCore, DraggableData, DraggableEvent } from "react-draggable";

import { Icon } from "@rmwc/icon";

type ColumnKey = {
  name: string;
  key: number;
};

type WorksheetRow = unknown[];
type WorksheetData = WorksheetRow[];

type ImportField = {
  fieldName: string;
  fieldType: models.EnumDataType;
  sampleData: unknown[];
  importable: boolean;
};

type TData = {
  createAppWithEntities: models.App;
};

type EntityWithViewData = models.AppCreateWithEntitiesEntityInput & {
  level?: number;
  levelIndex?: number;
};

type FormData = models.AppCreateWithEntitiesInput & {
  entities: EntityWithViewData[];
};

type EntityPositionData = {
  top: number;
  left: number;
};

const CLASS_NAME = "create-application-from-excel";
const MAX_SAMPLE_DATA = 3;

export function CreateApplicationFromExcel() {
  const [importList, setImportList] = React.useState<ImportField[]>([]);
  const [fileName, setFileName] = React.useState<string | null>(null);

  const { trackEvent } = useTracking();

  const history = useHistory();

  const onDrop = useCallback((acceptedFiles: File[]) => {
    const reader = new FileReader();
    const rABS = !!reader.readAsBinaryString;
    reader.onload = () => {
      setFileName(acceptedFiles[0].name);
      const wb = XLSX.read(reader.result, {
        type: rABS ? "binary" : "array",
      });
      /* Get first worksheet */
      const worksheetName = wb.SheetNames[0];
      const ws = wb.Sheets[worksheetName];
      /* Convert array of arrays */
      const jsonData = XLSX.utils.sheet_to_json(ws, {
        header: 1,
        blankrows: false,
      });

      const [headers, ...rest] = jsonData;

      const columns = generateColumnKeys(ws["!ref"]);
      buildImportList(rest as WorksheetData, headers as string[], columns);
    };

    // read file contents
    acceptedFiles.forEach((file) => reader.readAsBinaryString(file));
  }, []);

  const { getRootProps, getInputProps, isDragActive } = useDropzone({
    accept: SheetAcceptedFormats,
    maxFiles: 1,
    onDrop,
  });

  const [createAppWithEntities, { loading, data, error }] = useMutation<TData>(
    CREATE_APP_WITH_ENTITIES,
    {
      onCompleted: (data) => {
        trackEvent({
          eventName: "createAppFromFile",
          appName: data.createAppWithEntities.name,
        });
      },
      update(cache, { data }) {
        if (!data) return;
        const queryData = cache.readQuery<{ apps: Array<models.App> }>({
          query: GET_APPLICATIONS,
        });
        if (queryData === null) {
          return;
        }
        cache.writeQuery({
          query: GET_APPLICATIONS,
          data: {
            apps: queryData.apps.concat([data.createAppWithEntities]),
          },
        });
      },
    }
  );

  const clearSelectedFile = useCallback(() => {
    setFileName(null);
  }, [setFileName]);

  const initialValues = useMemo(() => {
    const data: FormData = {
      app: {
        name: fileName || "",
        description: fileName || "",
      },
      commitMessage: `Import schema from ${fileName}`,
      entities: [
        {
          name: fileName || "",
          fields: importList.map((field) => ({
            name: field.fieldName,
            dataType: field.fieldType,
          })),
        },
      ],
    };

    return data;
  }, [importList, fileName]);

  const handleSubmit = useCallback(
    (data: FormData) => {
      const sanitizedData: models.AppCreateWithEntitiesInput = omitDeep(data, [
        "level",
        "levelIndex",
      ]);
      console.log(sanitizedData);
      createAppWithEntities({ variables: { data: sanitizedData } }).catch(
        console.error
      );
    },
    [createAppWithEntities]
  );

  const errorMessage = formatError(error);

  useEffect(() => {
    if (data) {
      history.push(`/${data.createAppWithEntities.id}`);
    }
  }, [history, data]);

  const buildImportList = (
    data: WorksheetData,
    headers: string[],
    columns: ColumnKey[]
  ) => {
    const fields: ImportField[] = [];
    for (const column of columns) {
      if (!isEmpty(headers[column.key])) {
        const sampleData = getColumnSampleData(
          data,
          MAX_SAMPLE_DATA,
          column.key
        );
        const fieldName = headers[column.key];
        let fieldType: models.EnumDataType = models.EnumDataType.SingleLineText;

        if (fieldName.toLowerCase().includes("date")) {
          fieldType = models.EnumDataType.DateTime;
        } else if (sampleData.some((value) => isNaN(+value))) {
          fieldType = models.EnumDataType.SingleLineText;
        } else {
          if (sampleData.every((value) => Number.isInteger(value))) {
            fieldType = models.EnumDataType.WholeNumber;
          } else {
            fieldType = models.EnumDataType.DecimalNumber;
          }
        }

        fields.push({
          fieldName,
          fieldType,
          sampleData,
          importable: true,
        });
      }
    }
    setImportList(fields);
  };

  return (
    <MainLayout>
      <MainLayout.Menu />
      <MainLayout.Content>
        <div className={CLASS_NAME}>
          {isEmpty(fileName) ? (
            <>
              <div className={`${CLASS_NAME}__header`}>
                <h2>Import schema from excel</h2>

                <span className="spacer" />
              </div>
              <div className={`${CLASS_NAME}__message`}>
                Start building your application from an existing schema. Just
                upload an excel or CSV file to import its schema, and generate
                your node.JS application source code
              </div>
              <div
                {...getRootProps()}
                className={classNames(`${CLASS_NAME}__dropzone`, {
                  [`${CLASS_NAME}__dropzone--active`]: isDragActive,
                })}
              >
                <input {...getInputProps()} />
                {isDragActive ? (
                  <p>Drop the file here ...</p>
                ) : (
                  <p>Drag and drop a file here, or click to select a file</p>
                )}
              </div>

              {loading && (
                <div className={`${CLASS_NAME}__loader`}>
                  <CircularProgress />
                </div>
              )}
            </>
          ) : (
            <div className={`${CLASS_NAME}__layout`}>
              <div className={`${CLASS_NAME}__layout__toolbar`}>
                <Button
                  buttonStyle={EnumButtonStyle.Clear}
                  disabled={loading}
                  type="button"
                  onClick={clearSelectedFile}
                >
                  Back
                </Button>
              </div>
              <Formik
                initialValues={initialValues}
                enableReinitialize
                onSubmit={handleSubmit}
                render={({ values }) => (
                  <Form className={`${CLASS_NAME}__layout__body`}>
                    <div className={`${CLASS_NAME}__layout__body__side`}>
                      <div className={`${CLASS_NAME}__message`}>
                        Name your application, and edit the schema if needed.
                        You can also change the settings later. Click on "Create
                        App" when you are ready.
                      </div>

                      <h3>{fileName}</h3>

                      <DisplayNameField
                        name="app.name"
                        label="Application Name"
                        required
                      />

                      <Button
                        buttonStyle={EnumButtonStyle.Primary}
                        disabled={loading}
                        type="submit"
                      >
                        Create App
                      </Button>
                    </div>

                    <div className={`${CLASS_NAME}__layout__body__content`}>
                      <FieldArray
                        name="entities"
                        render={(arrayHelpers) => (
                          <div>
                            <div className={`${CLASS_NAME}__entities`}>
                              <DragDropEntitiesCanvas />
                            </div>
                          </div>
                        )}
                      />
                    </div>
                  </Form>
                )}
              />
            </div>
          )}
          <Snackbar open={Boolean(error)} message={errorMessage} />
        </div>
      </MainLayout.Content>
    </MainLayout>
  );
}

function EntityRelations() {
  const { values } = useFormikContext<FormData>();

  const relations = useMemo(() => {
    return values.entities.flatMap((entity, index) => {
      if (!entity.relationsToEntityIndex) return [];
      return entity.relationsToEntityIndex.map((relation) => ({
        key: `${index}_${relation}`,
        start: `entity${index}`,
        end: `entity${relation}`,
      }));
    });
  }, [values.entities]);

  return (
    <div>
      {relations.map((relation) => (
        <Xarrow {...relation} key={relation.key} />
      ))}
    </div>
  );
}

type EntityItemProps = {
  entityIndex: number;
  onDrag?: (entityIndex: number, positionData: EntityPositionData) => void;
};

const EntityItem = React.memo(({ entityIndex, onDrag }: EntityItemProps) => {
  const { setFieldValue, values } = useFormikContext<FormData>();

  const [position, setPosition] = useState<EntityPositionData>({
    top: 0,
    left: 0,
  });

  const handleAddEntity = useCallback(() => {
    const entities: EntityWithViewData[] = cloneDeep(values.entities);
    const currentLength = entities.length;
    const relations = entities[entityIndex].relationsToEntityIndex || [];
    const currentEntity = entities[entityIndex];

    const newEntityLevel = currentEntity.level ? currentEntity.level + 1 : 1;

    const levelEntities = entities.filter(
      (entity) => entity.level === newEntityLevel
    );

    const levelIndex = levelEntities.length;

    currentEntity.relationsToEntityIndex = [...relations, currentLength];

    setFieldValue(`entities`, [
      ...entities,
      {
        name: "new entity",
        fields: [],
        level: newEntityLevel,
        levelIndex: levelIndex,
      },
    ]);
  }, [entityIndex, setFieldValue, values.entities]);

  const currentEntity = values.entities[entityIndex];

  const handleDrag = useCallback(
    (e: DraggableEvent, data: DraggableData) => {
      setPosition((position) => {
        return {
          top: position.top + data.deltaY > 0 ? position.top + data.deltaY : 0,
          left:
            position.left + data.deltaX > 0 ? position.left + data.deltaX : 0,
        };
      });
      onDrag && onDrag(entityIndex, position);
    },
    [onDrag, setPosition, entityIndex, position]
  );

  return (
    <DraggableCore handle=".handle" onDrag={handleDrag}>
      <div
        id={`entity${entityIndex}`}
        className={`${CLASS_NAME}__entities__entity`}
        style={position}
      >
        <div>
          <div className={`${CLASS_NAME}__entities__entity__name `}>
            <Icon icon="menu" className="handle" />
            <EditableLabelField
              name={`entities.${entityIndex}.name`}
              label="Entity Name"
              required
            />
            <Button
              className={`${CLASS_NAME}__entities__entity__add`}
              buttonStyle={EnumButtonStyle.Clear}
              onClick={handleAddEntity}
              type="button"
              icon="plus"
            />
          </div>

          <FieldArray
            name={`entities.${entityIndex}.fields`}
            render={(fieldsArrayHelpers) => (
              <div className={`${CLASS_NAME}__fields`}>
                <Droppable droppableId={`droppable_${entityIndex}`}>
                  {(provided, snapshot) => (
                    <div
                      {...provided.droppableProps}
                      ref={provided.innerRef}
                      className={classNames(`${CLASS_NAME}__droppable`, {
                        [`${CLASS_NAME}__droppable--over`]: snapshot.isDraggingOver,
                      })}
                    >
                      {currentEntity.fields.map((field, fieldIndex) => (
                        <FieldItem
                          key={`${entityIndex}_${fieldIndex}`}
                          values={values}
                          entityIndex={entityIndex}
                          fieldIndex={fieldIndex}
                        />
                      ))}

                      {provided.placeholder}
                    </div>
                  )}
                </Droppable>
              </div>
            )}
          />
        </div>
      </div>
    </DraggableCore>
  );
});

type FieldItemProps = {
  values: FormData;
  entityIndex: number;
  fieldIndex: number;
  loading: boolean;
};

const FieldItem = React.memo(
  ({ values, entityIndex, fieldIndex, loading }: FieldItemProps) => {
    const dataType =
      values.entities[entityIndex].fields[fieldIndex].dataType ||
      models.EnumDataType.SingleLineText;

    return (
      <Draggable
        key={`${entityIndex}_${fieldIndex}`}
        draggableId={`${entityIndex}_${fieldIndex}`}
        index={fieldIndex}
      >
        {(provided, snapshot) => (
          <div ref={provided.innerRef} {...provided.draggableProps}>
            <div
              className={`${CLASS_NAME}__fields__field`}
              {...provided.dragHandleProps}
            >
              <Icon
                icon={{
                  icon: DATA_TYPE_TO_LABEL_AND_ICON[dataType].icon,
                  size: "xsmall",
                }}
              />
              {values.entities[entityIndex].fields[fieldIndex].name}
            </div>
          </div>
        )}
      </Draggable>
    );
  }
);

function DragDropEntitiesCanvas() {
  const { setFieldValue, values } = useFormikContext<FormData>();

  const onDragEnd = useCallback(
    (result: DropResult) => {
      // dropped outside the list
      if (!result.destination) {
        return;
      }

      const [sourceEntityIndex, sourceFieldIndex] = result.draggableId.split(
        "_"
      );
      const [, destinationEntityIndex] = result.destination.droppableId.split(
        "_"
      );
      const destinationFieldIndex = result.destination.index;

      const sourceFields = values.entities[Number(sourceEntityIndex)].fields;
      const [sourceField] = sourceFields.splice(Number(sourceFieldIndex), 1);

      setFieldValue(`entities.${sourceEntityIndex}.fields`, [...sourceFields]);

      const destinationFields =
        values.entities[Number(destinationEntityIndex)].fields;

      destinationFields.splice(destinationFieldIndex, 0, sourceField);

      setFieldValue(`entities.${destinationEntityIndex}.fields`, [
        ...destinationFields,
      ]);
    },
    [values, setFieldValue]
  );

  //used to force redraw the arrows (the internal lists of fields are not updated since it used  )
  const [, forceUpdate] = useReducer((x) => x + 1, 0);

  const handleEntityDrag = useCallback(
    (entityIndex: number, positionData: EntityPositionData) => {
      forceUpdate();
    },
    [forceUpdate]
  );

  return (
    <>
      <DragDropContext onDragEnd={onDragEnd}>
        {values.entities.map((entity, index) => (
          <EntityItem
            key={`entity_${index}`}
            entityIndex={index}
            onDrag={handleEntityDrag}
          />
        ))}
      </DragDropContext>
      <EntityRelations />
    </>
  );
}

/* list of supported file types */
// cSpell: disable
const SheetAcceptedFormats = [
  "xlsx",
  "xlsb",
  "xlsm",
  "xls",
  "xml",
  "csv",
  "txt",
  "ods",
  "fods",
  "uos",
  "sylk",
  "dif",
  "dbf",
  "prn",
  "qpw",
  "123",
  "wb*",
  "wq*",
  "html",
  "htm",
]
  .map((x) => `.${x}`)
  .join(",");
// cSpell: enable

const generateColumnKeys = (range: string): ColumnKey[] => {
  let keys = [],
    TotalColumns = XLSX.utils.decode_range(range).e.c + 1;

  for (var i = 0; i < TotalColumns; ++i)
    keys[i] = { name: XLSX.utils.encode_col(i), key: i };

  return keys;
};

function getColumnSampleData(
  data: WorksheetData,
  maxCount: number,
  columnKey: number
): unknown[] {
  const results: unknown[] = [];
  forEach(data, function (row) {
    if (results.length === maxCount) {
      return false;
    }
    if (undefined !== row[columnKey]) {
      results.push(row[columnKey]);
    }
  });
  return results;
}

const CREATE_APP_WITH_ENTITIES = gql`
  mutation createAppWithEntities($data: AppCreateWithEntitiesInput!) {
    createAppWithEntities(data: $data) {
      id
      name
      description
    }
  }
`;
